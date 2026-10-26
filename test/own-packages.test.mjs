import { test } from "node:test";
import assert from "node:assert/strict";

import { goModules, ownPackages, workspaceGlobs, workspacePackages } from "../plugins/anatomiya/lib/own-packages.mjs";

test("a workspace's packages are named by their manifests, and a name two manifests give, or a manifest that is no JSON, names nothing", () => {
  const packages = workspacePackages([
    { rel: "package.json", text: '{ "name": "monorepo", "private": true }' },
    { rel: "packages/common/package.json", text: '{ "name": "@excalidraw/common" }' },
    { rel: "packages/a/package.json", text: '{ "name": "dup" }' },
    { rel: "packages/b/package.json", text: '{ "name": "dup" }' },
    { rel: "packages/broken/package.json", text: "{ name: " },
    { rel: "packages/nameless/package.json", text: '{ "version": "1.0.0" }' },
  ], ["packages/*"]);
  assert.deepEqual([...packages], [["@excalidraw/common", { dir: "packages/common", entries: [] }], ["dup", null]]);
});

test("a workspace's packages are only the manifests its own workspace globs reach, so a fixture named like a dependency is no package", () => {
  const manifests = [
    { rel: "package.json", text: '{ "name": "mono", "workspaces": ["packages/*", "!packages/legacy"] }' },
    { rel: "packages/ui/package.json", text: '{ "name": "@acme/ui" }' },
    { rel: "packages/legacy/package.json", text: '{ "name": "@acme/legacy" }' },
    { rel: "test/fixtures/react/package.json", text: '{ "name": "react" }' },
  ];
  const globs = workspaceGlobs({ root: manifests[0].text });
  assert.deepEqual(globs, ["packages/*", "!packages/legacy"]);
  assert.deepEqual([...workspacePackages(manifests, globs).keys()], ["@acme/ui"]);
  // pnpm and lerna name theirs in files of their own; Yarn's object form names them under `packages`.
  assert.deepEqual(workspaceGlobs({ pnpm: "packages:\n  - 'apps/*'\n  - \"libs/**\"\n# done\n" }), ["apps/*", "libs/**"]);
  assert.deepEqual(workspaceGlobs({ lerna: '{ "version": "1.0.0" }' }), ["packages/*"]);
  assert.deepEqual(workspaceGlobs({ root: '{ "workspaces": { "packages": ["modules/**"] } }' }), ["modules/**"]);
  // No workspace at all: no manifest is another package of it.
  assert.equal(workspaceGlobs({ root: '{ "name": "solo" }' }), null);
  assert.deepEqual([...workspacePackages(manifests, null).keys()], []);
  assert.deepEqual([...workspacePackages([{ rel: "libs/a/b/package.json", text: '{ "name": "deep" }' }], ["libs/**"]).keys()], ["deep"]);
});

test("a Go module is named by its go.mod, and a file that is no module names nothing", () => {
  const modules = goModules([
    { rel: "go.mod", text: "module github.com/acme/shop\n\ngo 1.22\n" },
    { rel: "tools/go.mod", text: "// tools\nmodule \"github.com/acme/shop/tools\"\n" },
    { rel: "broken/go.mod", text: "go 1.22\n" },
  ]);
  assert.deepEqual([...modules], [["github.com/acme/shop", ""], ["github.com/acme/shop/tools", "tools"]]);
});


test("a workspace glob may start with ./, end with /, and hold ** for no segment as well as for many", () => {
  const dirs = (globs, ...rels) => [...workspacePackages(rels.map((rel, i) => ({ rel, text: `{ "name": "p${i}" }` })), globs).values()].map((p) => p.dir);
  assert.deepEqual(dirs(["./packages/*/"], "packages/a/package.json", "packages/a/b/package.json"), ["packages/a"]);
  assert.deepEqual(dirs(["packages/**/*"], "packages/a/package.json", "packages/a/b/package.json", "other/package.json"), ["packages/a", "packages/a/b"]);
  assert.deepEqual(dirs(["**/pkg"], "pkg/package.json", "a/b/pkg/package.json", "a/pkgs/package.json"), ["pkg", "a/b/pkg"]);
  assert.deepEqual(dirs(["libs/**"], "libs/package.json", "libs/x/package.json"), ["libs", "libs/x"]);
});

test("pnpm's flow list and Rush's project folders name a workspace too", () => {
  assert.deepEqual(workspaceGlobs({ pnpm: "packages: ['packages/*', \"apps/*\"]\n" }), ["packages/*", "apps/*"]);
  const rush = '// Rush\n{\n  /* the projects */\n  "projects": [\n    { "packageName": "@acme/ui", "projectFolder": "libs/ui" }\n  ]\n}\n';
  assert.deepEqual(workspaceGlobs({ rush }), ["libs/ui"]);
});

test("a workspace file written on Windows, or with comments and commas JSON refuses, still names its packages", () => {
  assert.deepEqual(workspaceGlobs({ pnpm: "packages:\r\n  - 'packages/*'\r\n  - \"apps/*\" # the apps\r\nother: 1\r\n" }), ["packages/*", "apps/*"]);
  const rush = '{\n  "rushVersion": "5.0.0", // pinned\n  "note": "a/*b // c*/d",\n  "projects": [\n    { "projectFolder": "libs/ui", },\n  ],\n}\n';
  assert.deepEqual(workspaceGlobs({ rush }), ["libs/ui"]);
});

test("a repository's own packages come from every manifest it tracks", () => {
  const own = ownPackages([
    { rel: "package.json", text: '{ "workspaces": ["packages/*"] }' },
    { rel: "packages/ui/package.json", text: '{ "name": "@acme/ui" }' },
    { rel: "go.mod", text: "module github.com/acme/shop\n" },
  ]);
  assert.deepEqual([...own.packages.keys()], ["@acme/ui"]);
  assert.deepEqual([...own.modules], [["github.com/acme/shop", ""]]);
});
