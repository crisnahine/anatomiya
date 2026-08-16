import { test } from "node:test";
import assert from "node:assert/strict";

import { RUNTIME_MODULES, commonImports, mostImported, specifierToFile } from "../lib/siblings.mjs";

const isRelative = (m) => m.startsWith("./") || m.startsWith("../") || m === "." || m === "..";

/** A parse record as the worker writes it, carrying only what these read. */
const record = (rel, modules) => ({
  rel,
  ok: true,
  facets: {
    imports: modules.map((m) =>
      typeof m === "string"
        ? { module: m, names: ["default"], relative: isRelative(m) }
        : { module: m.module, names: m.names, relative: isRelative(m.module) }
    ),
  },
});

const files = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const corpus = (...rels) => new Set(rels);

test("a module clears the share floor over the files that import anything", () => {
  const records = [
    ...files(4, (i) => record(`src/a${i}.tsx`, ["styled-components", "./local"])),
    ...files(2, (i) => record(`src/b${i}.tsx`, ["formik"])),
  ];

  assert.deepEqual(commonImports(records), [{ module: "styled-components", files: 4, of: 6 }]);
});

test("a relative specifier is a sibling import, not a convention", () => {
  const records = files(6, (i) => record(`src/a${i}.ts`, ["./neighbour", "../shared/x", "lodash"]));

  assert.deepEqual(
    commonImports(records).map((c) => c.module),
    ["lodash"]
  );
});

test("the runtime a JSX area cannot be written without is not a habit anyone chose", () => {
  const records = files(6, (i) => record(`src/a${i}.tsx`, [...RUNTIME_MODULES, "styled-components"]));

  assert.deepEqual(commonImports(records), [{ module: "styled-components", files: 6, of: 6 }]);
});

test("fewer than five importing files says nothing, whatever the share", () => {
  const records = files(4, (i) => record(`src/a${i}.ts`, ["lodash"]));

  assert.deepEqual(commonImports(records), [], "four files agreeing is four files");
});

test("a file that imports nothing is out of the denominator, not a zero in it", () => {
  const records = [
    ...files(5, (i) => record(`src/a${i}.ts`, ["lodash"])),
    ...files(5, (i) => record(`src/b${i}.ts`, [])),
  ];

  assert.deepEqual(commonImports(records), [{ module: "lodash", files: 5, of: 5 }]);
});

test("the roster is the top three by share and stops there", () => {
  const records = [
    ...files(10, (i) => record(`src/a${i}.ts`, ["one", "two", "three", "four"])),
    ...files(2, (i) => record(`src/b${i}.ts`, ["one", "two", "three"])),
    ...files(1, () => record("src/c.ts", ["one", "two"])),
    ...files(1, () => record("src/d.ts", ["one"])),
  ];

  assert.deepEqual(commonImports(records), [
    { module: "one", files: 14, of: 14 },
    { module: "two", files: 13, of: 14 },
    { module: "three", files: 12, of: 14 },
  ]);
});

test("a module under the 0.60 share is not what most files here import", () => {
  const records = [
    ...files(5, (i) => record(`src/a${i}.ts`, ["axios"])),
    ...files(5, (i) => record(`src/b${i}.ts`, ["ky"])),
  ];

  assert.deepEqual(commonImports(records), []);
});

test("a record the parse never answered for counts on neither side", () => {
  const records = [
    ...files(5, (i) => record(`src/a${i}.ts`, ["lodash"])),
    { rel: "src/broken.ts", ok: false, error: "1 syntax error(s)" },
    { rel: "src/thing.rb", ok: true, facets: { testRunner: null, testCalls: false } },
  ];

  assert.deepEqual(commonImports(records), [{ module: "lodash", files: 5, of: 5 }]);
});

test("a relative specifier resolves against the importer's directory", () => {
  const rels = corpus("src/components/Avatar.tsx", "src/utils/user.ts", "src/utils/index.js", "src/legacy.mjs");

  assert.equal(specifierToFile("../utils/user", "src/components/Avatar.tsx", rels), "src/utils/user.ts");
  assert.equal(specifierToFile("./Avatar", "src/components/List.tsx", rels), "src/components/Avatar.tsx");
  assert.equal(specifierToFile("../utils", "src/components/List.tsx", rels), "src/utils/index.js");
  assert.equal(specifierToFile("./legacy.mjs", "src/app.ts", rels), "src/legacy.mjs", "an extension already written");
  assert.equal(specifierToFile("./missing", "src/app.ts", rels), null);
});

test("an alias tail matches the file it names, and an ambiguous one matches nothing", () => {
  const rels = corpus("src/utils/user.ts", "src/components/Avatar.tsx");

  for (const spec of ["~/utils/user", "@/utils/user", "#/utils/user", "src/utils/user"]) {
    assert.equal(specifierToFile(spec, "src/app.ts", rels), "src/utils/user.ts", spec);
  }

  const twice = corpus("src/utils/user.ts", "packages/web/utils/user.ts");
  assert.equal(specifierToFile("~/utils/user", "src/app.ts", twice), null, "two files answer, so none does");
});

test("a bare package name is not a file in this repository", () => {
  const rels = corpus("src/react.ts", "src/utils/user.ts");

  assert.equal(specifierToFile("react", "src/app.ts", rels), null);
  assert.equal(specifierToFile("@scope/pkg", "src/app.ts", rels), null);
  assert.equal(specifierToFile("node:path", "src/app.ts", rels), null);
});

test("a tail that names a directory resolves through its index", () => {
  const rels = corpus("src/utils/index.ts", "app/utils/user.ts");

  assert.equal(specifierToFile("~/utils", "src/app.ts", rels), null, "one segment is not a tail");
  assert.equal(specifierToFile("@/src/utils", "src/app.ts", rels), "src/utils/index.ts");
  assert.equal(
    specifierToFile("#/app/utils/user", "src/app.ts", rels),
    "app/utils/user.ts",
    "a path from the repository root is a tail of itself"
  );
});

test("the names other files import from here are ranked by how many import them", () => {
  const rels = corpus("src/utils/user.ts", "src/app.ts");
  const records = new Map();
  for (let i = 0; i < 4; i++) {
    records.set(`src/pages/p${i}.tsx`, record(`src/pages/p${i}.tsx`, [{ module: "~/utils/user", names: ["getFullName"] }]));
  }
  for (let i = 0; i < 3; i++) {
    records.set(`src/other/o${i}.tsx`, record(`src/other/o${i}.tsx`, [{ module: "../utils/user", names: ["initials"] }]));
  }
  records.set("src/one.ts", record("src/one.ts", [{ module: "~/utils/user", names: ["rare"] }]));

  assert.deepEqual(mostImported(new Set(["src/utils/user.ts"]), records, rels), [
    { name: "getFullName", file: "src/utils/user.ts", importers: 4 },
    { name: "initials", file: "src/utils/user.ts", importers: 3 },
  ]);
});

test("a default import counts under default and a namespace import under *", () => {
  const rels = corpus("src/utils/user.ts");
  const records = new Map();
  for (let i = 0; i < 3; i++) {
    records.set(`src/a${i}.ts`, record(`src/a${i}.ts`, [{ module: "~/utils/user", names: ["default"] }]));
  }
  for (let i = 0; i < 3; i++) {
    records.set(`src/b${i}.ts`, record(`src/b${i}.ts`, [{ module: "~/utils/user", names: ["*"] }]));
  }

  assert.deepEqual(mostImported(new Set(["src/utils/user.ts"]), records, rels), [
    { name: "*", file: "src/utils/user.ts", importers: 3 },
    { name: "default", file: "src/utils/user.ts", importers: 3 },
  ]);
});

test("two importers is not a habit worth naming", () => {
  const rels = corpus("src/utils/user.ts");
  const records = new Map(
    files(2, (i) => [`src/a${i}.ts`, record(`src/a${i}.ts`, [{ module: "~/utils/user", names: ["x"] }])])
  );

  assert.deepEqual(mostImported(new Set(["src/utils/user.ts"]), records, rels), []);
});

test("the reuse roster is the top five and never a list of every name", () => {
  const rels = corpus("src/lib/a.ts");
  const records = new Map();
  const names = ["n1", "n2", "n3", "n4", "n5", "n6"];
  names.forEach((name, rank) => {
    for (let i = 0; i <= 10 - rank; i++) {
      const rel = `src/${name}-${i}.ts`;
      records.set(rel, record(rel, [{ module: "~/lib/a", names: [name] }]));
    }
  });

  const top = mostImported(new Set(["src/lib/a.ts"]), records, rels);
  assert.deepEqual(
    top.map((r) => r.name),
    ["n1", "n2", "n3", "n4", "n5"]
  );
  assert.deepEqual(top[0], { name: "n1", file: "src/lib/a.ts", importers: 11 });
});

test("a name imported from outside the area is somebody else's roster", () => {
  const rels = corpus("src/lib/a.ts", "vendor/b.ts");
  const records = new Map(
    files(4, (i) => [`src/p${i}.ts`, record(`src/p${i}.ts`, [{ module: "~/vendor/b", names: ["helper"] }])])
  );

  assert.deepEqual(mostImported(new Set(["src/lib/a.ts"]), records, rels), []);
});

test("one importer naming a file twice is one importer", () => {
  const rels = corpus("src/lib/a.ts");
  const records = new Map();
  for (let i = 0; i < 3; i++) {
    const rel = `src/pages/p${i}.ts`;
    records.set(
      rel,
      record(rel, [
        { module: "~/lib/a", names: ["helper"] },
        { module: "../lib/a", names: ["helper"] },
      ])
    );
  }

  assert.deepEqual(mostImported(new Set(["src/lib/a.ts"]), records, rels), [
    { name: "helper", file: "src/lib/a.ts", importers: 3 },
  ]);
});

test("the same records read against another corpus resolve against that corpus", () => {
  // The reuse index is built once per corpus and kept, so a second corpus has
  // to rebuild it rather than answer with where the files used to be.
  const records = new Map(
    files(3, (i) => [`src/p${i}.ts`, record(`src/p${i}.ts`, [{ module: "~/lib/a", names: ["helper"] }])])
  );

  assert.deepEqual(mostImported(new Set(["src/lib/a.ts"]), records, corpus("src/lib/a.ts")), [
    { name: "helper", file: "src/lib/a.ts", importers: 3 },
  ]);
  assert.deepEqual(mostImported(new Set(["packages/lib/a.ts"]), records, corpus("packages/lib/a.ts")), [
    { name: "helper", file: "packages/lib/a.ts", importers: 3 },
  ]);
});

test("a file under a directory named index is one file, not an ambiguous tail", () => {
  const rels = corpus("src/index/index.ts", "src/utils/user.ts");

  assert.equal(specifierToFile("~/src/index", "src/app.ts", rels), "src/index/index.ts");
});

test("a runtime package is runtime on every subpath, and a package with the same prefix is not", () => {
  const records = files(6, (i) =>
    record(`src/a${i}.tsx`, ["next/link", "next/router", "react-dom/client", "next-auth", "@scope/pkg/sub"])
  );

  assert.deepEqual(
    commonImports(records).map((c) => c.module),
    ["@scope/pkg/sub", "next-auth"]
  );
});

test("reuse counts the files outside the area, not the siblings inside it", () => {
  // "what do other parts of the repository import from here" is the question.
  // A directory importing its own files is how it is written, not who depends
  // on it.
  const area = new Set(["src/utils/user.ts", "src/utils/a.ts", "src/utils/b.ts", "src/utils/c.ts"]);
  const rels = corpus(...area, "src/pages/p0.ts", "src/pages/p1.ts");
  const records = new Map();
  for (const rel of ["src/utils/a.ts", "src/utils/b.ts", "src/utils/c.ts"]) {
    records.set(rel, record(rel, [{ module: "./user", names: ["fullName"] }]));
  }
  for (const rel of ["src/pages/p0.ts", "src/pages/p1.ts"]) {
    records.set(rel, record(rel, [{ module: "~/src/utils/user", names: ["fullName"] }]));
  }

  assert.deepEqual(mostImported(area, records, rels), [], "three siblings and two outsiders is two importers");
});

test("five files outside the area is five importers", () => {
  const area = new Set(["src/utils/user.ts", "src/utils/a.ts"]);
  const outside = files(5, (i) => `src/pages/p${i}.ts`);
  const rels = corpus(...area, ...outside);
  const records = new Map([
    ["src/utils/a.ts", record("src/utils/a.ts", [{ module: "./user", names: ["fullName"] }])],
    ...outside.map((rel) => [rel, record(rel, [{ module: "~/src/utils/user", names: ["fullName"] }])]),
  ]);

  assert.deepEqual(mostImported(area, records, rels), [
    { name: "fullName", file: "src/utils/user.ts", importers: 5 },
  ]);
});
