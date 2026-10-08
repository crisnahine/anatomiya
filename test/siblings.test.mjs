import { test } from "node:test";
import assert from "node:assert/strict";

import { RUNTIME_MODULES, commonImports, mostImported, specifierToFile } from "../plugins/anatomiya/lib/siblings.mjs";

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
  // Spelled out rather than spread from the table: a list read off the thing
  // under test agrees with it whatever it holds.
  const runtime = ["react", "react-dom", "react/jsx-runtime", "vue", "@angular/core", "svelte", "next"];
  const records = files(6, (i) => record(`src/a${i}.tsx`, [...runtime, "styled-components"]));

  assert.deepEqual([...RUNTIME_MODULES].sort(), [...runtime].sort(), "and the table holds those seven");
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

test("a specifier ending in a slash names the directory's index", () => {
  // Node and TypeScript read `./base/` as the directory `./base`, never as a
  // file `base.ts`, and `./` and `../` as `.` and `..`.
  const rels = corpus("src/components/base/index.ts", "src/components/base.ts", "src/index.ts", "src/components/index.ts");

  assert.equal(specifierToFile("./base/", "src/components/A.tsx", rels), "src/components/base/index.ts");
  assert.equal(specifierToFile("./base", "src/components/A.tsx", rels), "src/components/base.ts");
  assert.equal(specifierToFile("./", "src/components/A.tsx", rels), "src/components/index.ts");
  assert.equal(specifierToFile("../", "src/components/A.tsx", rels), "src/index.ts");
  assert.equal(specifierToFile("../../components/", "src/components/base/Icon.tsx", rels), "src/components/index.ts");
  assert.equal(specifierToFile("@/components/base/", "src/app.ts", rels), "src/components/base/index.ts", "through an alias too");
  assert.equal(specifierToFile("./nothing/", "src/components/A.tsx", rels), null);
});

test("a compiled specifier resolves to the TypeScript source it is emitted from", () => {
  // TypeScript under Node16 and NodeNext requires the emitted extension on every
  // relative import, so `../utils/format.js` is how a service names
  // `src/utils/format.ts`. Measured: a repository written that way lost its
  // "Most imported from here" line in every area, 1 with reuse against 0.
  const rels = corpus("src/utils/format.ts", "src/ui/Button.tsx", "src/lib/esm.mts", "src/lib/cjs.cts", "src/app/main.ts");

  assert.equal(specifierToFile("../utils/format.js", "src/app/main.ts", rels), "src/utils/format.ts");
  assert.equal(specifierToFile("../ui/Button.js", "src/app/main.ts", rels), "src/ui/Button.tsx");
  assert.equal(specifierToFile("../ui/Button.jsx", "src/app/main.ts", rels), "src/ui/Button.tsx");
  assert.equal(specifierToFile("../lib/esm.mjs", "src/app/main.ts", rels), "src/lib/esm.mts");
  assert.equal(specifierToFile("../lib/cjs.cjs", "src/app/main.ts", rels), "src/lib/cjs.cts");
  assert.equal(specifierToFile("@/utils/format.js", "src/app/main.ts", rels), "src/utils/format.ts", "through an alias too");
});

test("a specifier with an extension names only the file it spells or the source that emits it", () => {
  // The written file wins where it exists, and a `.js` is never emitted from an
  // `.mts`, so dropping the extension outright would credit the wrong module
  // with its importers.
  const both = corpus("src/utils/format.ts", "src/utils/format.js");
  assert.equal(specifierToFile("./format.js", "src/utils/x.ts", both), "src/utils/format.js");

  const other = corpus("src/utils/format.mts", "src/utils/parse.rb");
  assert.equal(specifierToFile("./format.js", "src/utils/x.ts", other), null);
  assert.equal(specifierToFile("@/utils/format.js", "src/app.ts", other), null);
  assert.equal(specifierToFile("@/utils/parse.js", "src/app.ts", other), null, "a tail is not any file sharing its stem");
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

test("a default import is named for its module and a namespace import is no name at all", () => {
  // Ranked as export names, these printed "most imported from here:  (5
  // files), default (5)" on an area file: `*` encodes to nothing a reader can
  // look for, and `default` says nothing about which module it came out of.
  const rels = corpus("src/utils/user.ts", "src/ui/Button/index.tsx");
  const records = new Map();
  for (let i = 0; i < 3; i++) {
    records.set(`src/a${i}.ts`, record(`src/a${i}.ts`, [{ module: "~/utils/user", names: ["default"] }]));
  }
  for (let i = 0; i < 3; i++) {
    records.set(`src/b${i}.ts`, record(`src/b${i}.ts`, [{ module: "~/utils/user", names: ["*"] }]));
  }
  for (let i = 0; i < 4; i++) {
    records.set(`src/c${i}.ts`, record(`src/c${i}.ts`, [{ module: "~/ui/Button", names: ["default"] }]));
  }

  assert.deepEqual(mostImported(new Set(["src/utils/user.ts", "src/ui/Button/index.tsx"]), records, rels), [
    // An index file is imported by its directory's name, so that is its name.
    { name: "Button (default)", file: "src/ui/Button/index.tsx", importers: 4 },
    { name: "user (default)", file: "src/utils/user.ts", importers: 3 },
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

test("a case tie in either roster orders by code unit, not by the host's locale", () => {
  // Both rosters print, and `localeCompare` orders case by whatever ICU tables
  // the host was built with.
  const records = files(5, (i) => record(`src/a${i}.ts`, ["foo/x", "Foo/x"]));

  assert.deepEqual(
    commonImports(records).map((c) => c.module),
    ["Foo/x", "foo/x"]
  );

  const rels = corpus("src/lib/a.ts");
  const importers = new Map(
    files(3, (i) => [`src/p${i}.ts`, record(`src/p${i}.ts`, [{ module: "~/lib/a", names: ["foo", "Foo"] }])])
  );

  assert.deepEqual(
    mostImported(new Set(["src/lib/a.ts"]), importers, rels).map((r) => r.name),
    ["Foo", "foo"]
  );
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

test("a specifier spelling a component's extension names that file", () => {
  const rels = corpus("src/components/Foo.vue", "src/lib/Bar.svelte", "src/app.ts");

  assert.equal(specifierToFile("./Foo.vue", "src/components/List.vue", rels), "src/components/Foo.vue");
  assert.equal(specifierToFile("../lib/Bar.svelte", "src/components/List.vue", rels), "src/lib/Bar.svelte");
  assert.equal(specifierToFile("@/components/Foo.vue", "src/app.ts", rels), "src/components/Foo.vue");
  assert.equal(specifierToFile("~/lib/Bar.svelte", "src/app.ts", rels), "src/lib/Bar.svelte");
});

test("a bare stem does not resolve to a component", () => {
  const rels = corpus("src/components/Foo.vue", "src/lib/Bar.svelte", "src/widgets/index.vue", "src/app.ts");

  assert.equal(specifierToFile("./Foo", "src/components/List.vue", rels), null);
  assert.equal(specifierToFile("../lib/Bar", "src/components/List.vue", rels), null);
  assert.equal(specifierToFile("@/components/Foo", "src/app.ts", rels), null, "through an alias too");
  assert.equal(specifierToFile("~/lib/Bar", "src/app.ts", rels), null);
  assert.equal(specifierToFile("./widgets", "src/app.ts", rels), null, "a directory is not its index component");
  assert.equal(specifierToFile("./widgets/", "src/app.ts", rels), null);
  assert.equal(specifierToFile("@/src/widgets", "src/app.ts", rels), null);
  assert.equal(specifierToFile("@/src/widgets/", "src/app.ts", rels), null);
});

test("a compiled spelling of a component's name is another file", () => {
  const rels = corpus("src/components/Foo.vue", "src/app.ts");

  assert.equal(specifierToFile("./Foo.vue.js", "src/components/List.vue", rels), null);
  assert.equal(specifierToFile("@/components/Foo.vue.js", "src/app.ts", rels), null);
  assert.equal(specifierToFile("./Foo.vue?raw", "src/components/List.vue", rels), null, "a query names no file here, on any extension");

  const both = corpus("src/components/Foo.vue", "src/components/Foo.vue.ts", "src/app.ts");
  assert.equal(specifierToFile("@/components/Foo.vue", "src/app.ts", both), "src/components/Foo.vue", "the file spelled wins");
  assert.equal(specifierToFile("@/components/Foo.vue.js", "src/app.ts", both), "src/components/Foo.vue.ts");
});

test("a component beside a module of its name takes nothing from the module", () => {
  // Sharing a tail made the two ambiguous, and the module stopped resolving.
  const rels = corpus("src/components/Foo.vue", "src/components/Foo.ts", "src/app.ts");

  assert.equal(specifierToFile("@/components/Foo", "src/app.ts", rels), "src/components/Foo.ts");
  assert.equal(specifierToFile("./Foo", "src/components/List.vue", rels), "src/components/Foo.ts");
  assert.equal(specifierToFile("@/components/Foo.vue", "src/app.ts", rels), "src/components/Foo.vue");
});

test("a component's importers are counted where they spell its name", () => {
  const rels = corpus("src/components/Foo.vue", "src/app.ts");
  const records = new Map();
  for (let i = 0; i < 3; i++) {
    records.set(`src/pages/p${i}.vue`, record(`src/pages/p${i}.vue`, ["../components/Foo.vue"]));
  }
  for (let i = 0; i < 3; i++) {
    records.set(`src/other/o${i}.ts`, record(`src/other/o${i}.ts`, ["../components/Foo"]));
  }

  assert.deepEqual(mostImported(new Set(["src/components/Foo.vue"]), records, rels), [
    { name: "Foo (default)", file: "src/components/Foo.vue", importers: 3 },
  ]);
});

test("SvelteKit's $lib names a file under src/lib, as the other root prefixes name theirs", () => {
  const rels = corpus("src/lib/utils.ts", "src/lib/components/ui/button/index.ts", "src/lib/Card.svelte", "src/routes/+page.svelte");

  assert.equal(specifierToFile("$lib/utils", "src/routes/+page.svelte", rels), "src/lib/utils.ts");
  assert.equal(specifierToFile("$lib/utils.js", "src/routes/+page.svelte", rels), "src/lib/utils.ts");
  assert.equal(specifierToFile("$lib/components/ui/button", "src/routes/+page.svelte", rels), "src/lib/components/ui/button/index.ts");
  assert.equal(specifierToFile("$lib/components/ui/button/", "src/routes/+page.svelte", rels), "src/lib/components/ui/button/index.ts");
  assert.equal(specifierToFile("$lib/Card.svelte", "src/routes/+page.svelte", rels), "src/lib/Card.svelte");
  assert.equal(specifierToFile("$lib/Card", "src/routes/+page.svelte", rels), null, "a bare stem is no component here either");
});

test("$lib is the importer's own project's src/lib, in a repository holding two", () => {
  const rels = corpus(
    "apps/a/src/lib/utils.ts",
    "apps/a/src/lib/ui/button/index.ts",
    "apps/a/src/lib/Card.svelte",
    "apps/a/src/lib/count.svelte.ts",
    "apps/b/src/lib/utils.ts",
    "apps/b/src/lib/only-b.ts"
  );
  const fromA = (spec, importer = "apps/a/src/routes/+page.svelte") => specifierToFile(spec, importer, rels);

  assert.equal(fromA("$lib/utils"), "apps/a/src/lib/utils.ts");
  assert.equal(fromA("$lib/utils.js"), "apps/a/src/lib/utils.ts");
  assert.equal(specifierToFile("$lib/utils", "apps/b/src/routes/blog/+page.ts", rels), "apps/b/src/lib/utils.ts");
  assert.equal(fromA("$lib/utils", "apps/a/src/lib/ui/button/button.svelte"), "apps/a/src/lib/utils.ts", "from inside src/lib too");
  assert.equal(fromA("$lib/ui/button"), "apps/a/src/lib/ui/button/index.ts");
  assert.equal(fromA("$lib/ui/button/index.js"), "apps/a/src/lib/ui/button/index.ts");
  assert.equal(fromA("$lib/ui/button/"), "apps/a/src/lib/ui/button/index.ts");
  assert.equal(fromA("$lib/Card.svelte"), "apps/a/src/lib/Card.svelte");
  assert.equal(fromA("$lib/count.svelte"), "apps/a/src/lib/count.svelte.ts");
  assert.equal(fromA("$lib/count.svelte.js"), "apps/a/src/lib/count.svelte.ts");
  assert.equal(fromA("$lib/only-b"), null, "another app's file is not this one's");
});

test("$lib names nothing outside a src/lib above the importer", () => {
  const page = "app/src/routes/+page.svelte";

  assert.equal(specifierToFile("$lib/x", page, corpus("tools/lib/x.ts")), null, "a lib with no src");
  assert.equal(specifierToFile("$lib/x", page, corpus("app/src/lib/sub/lib/x.ts")), null, "a lib nested in the real one");
  assert.equal(specifierToFile("$lib/x", page, corpus("app/src/components/x.ts")), null);
  assert.equal(specifierToFile("$lib/x", "scripts/build.ts", corpus("site/src/lib/x.ts")), null, "no src/lib above the importer");
  assert.equal(specifierToFile("$lib/x", "site/src/routes/+page.svelte", corpus("site/src/lib/x.ts", "tools/lib/x.ts")), "site/src/lib/x.ts");
  assert.equal(specifierToFile("@/components/x", page, corpus("app/src/components/x.ts")), "app/src/components/x.ts", "the root prefixes read as they did");
});

test("an alias a component writes names a file of its own project, and no other package's", () => {
  const rels = corpus(
    "apps/lib/components/ui/button.tsx",
    "blocks/vue/components/ui/Button.vue",
    "blocks/vue/components/ui/card/index.ts",
    "blocks/vue/src/composables/use-user.ts",
    "blocks/vue/lib/utils.ts"
  );
  const form = "blocks/vue/forms/nuxtjs/app/form.vue";

  assert.equal(specifierToFile("@/components/ui/button", form, rels), null, "the React file in the other package");
  assert.equal(specifierToFile("~/components/ui/button", form, rels), null);
  assert.equal(specifierToFile("@/components/ui/Button.vue", form, rels), "blocks/vue/components/ui/Button.vue");
  assert.equal(specifierToFile("@/components/ui/card", form, rels), "blocks/vue/components/ui/card/index.ts");
  assert.equal(specifierToFile("@/components/ui/card/", form, rels), "blocks/vue/components/ui/card/index.ts");
  assert.equal(specifierToFile("~/lib/utils.js", form, rels), "blocks/vue/lib/utils.ts");
  assert.equal(specifierToFile("@/composables/use-user", form, rels), "blocks/vue/src/composables/use-user.ts", "a root under src");
  assert.equal(specifierToFile("@/ui/button", "apps/lib/pages/page.svelte", rels), null, "a tail is not a place in the project");
  assert.equal(specifierToFile("@/components/ui/button", "apps/lib/pages/page.tsx", rels), "apps/lib/components/ui/button.tsx");
});

test("the nearest project above a component answers its alias", () => {
  const rels = corpus("apps/a/src/lib/utils.ts", "apps/b/src/lib/utils.ts", "apps/b/src/lib/only-b.ts");

  assert.equal(specifierToFile("@/lib/utils", "apps/a/src/pages/Home.vue", rels), "apps/a/src/lib/utils.ts");
  assert.equal(specifierToFile("@/lib/utils", "apps/b/src/pages/Home.vue", rels), "apps/b/src/lib/utils.ts");
  assert.equal(specifierToFile("@/lib/only-b", "apps/a/src/pages/Home.vue", rels), null, "another app's file is not this one's");
  assert.equal(specifierToFile("@/lib/utils", "apps/a/src/pages/home.ts", rels), null, "a module's alias is matched as a tail, which two files answer");
});

test("an alias two directories above a component both answer names neither file", () => {
  // The root the alias means is one of them and no path says which: a feature's own directory is not it.
  const button = corpus("src/features/cart/CartPage.vue", "src/features/cart/components/Button.vue", "src/components/Button.vue");
  assert.equal(specifierToFile("@/components/Button.vue", "src/features/cart/CartPage.vue", button), null);
  const format = corpus("src/features/cart/Cart.vue", "src/features/cart/utils/format.ts", "src/utils/format.ts");
  assert.equal(specifierToFile("@/utils/format", "src/features/cart/Cart.vue", format), null);
  assert.equal(specifierToFile("$lib/utils", "apps/a/src/routes/+page.svelte", corpus("apps/a/src/lib/utils.ts", "src/lib/utils.ts")), null);

  // One file reached from two directories, as `src/components` and as `components` under `src`, is one answer.
  assert.equal(specifierToFile("@/components/Button.vue", "src/pages/Home.vue", corpus("src/components/Button.vue")), "src/components/Button.vue");
  assert.equal(specifierToFile("@/components/Button.vue", "src/features/cart/CartPage.vue", corpus("src/components/Button.vue")), "src/components/Button.vue");
});

test("a component's alias import credits no file of another package", () => {
  const rels = corpus("apps/lib/components/ui/button.tsx", "blocks/vue/components/ui/Button.vue");
  const records = new Map();
  for (let i = 0; i < 6; i++) records.set(`apps/lib/pages/p${i}.tsx`, record(`apps/lib/pages/p${i}.tsx`, [{ module: "@/components/ui/button", names: ["Button"] }]));
  for (let i = 0; i < 5; i++) records.set(`blocks/vue/forms/f${i}.vue`, record(`blocks/vue/forms/f${i}.vue`, [{ module: "@/components/ui/button", names: ["Button"] }]));

  assert.deepEqual(mostImported(new Set(["apps/lib/components/ui/button.tsx"]), records, rels), [
    { name: "Button", file: "apps/lib/components/ui/button.tsx", importers: 6 },
  ]);
});

test("SvelteKit's virtual modules name no file", () => {
  // Every place a prefix read as an alias could land.
  const rels = corpus(
    "src/app/navigation.ts",
    "src/lib/app/navigation.ts",
    "src/lib/navigation.ts",
    "src/lib/state.ts",
    "src/env/static/public.ts",
    "src/lib/env/static/public.ts",
    "src/lib/static/public.ts",
    "src/lib/dynamic/private.ts",
    "src/service-worker.ts",
    "src/lib/service-worker/index.ts"
  );

  for (const spec of ["$app/navigation", "$app/state", "$env/static/public", "$env/dynamic/private", "$service-worker"]) {
    assert.equal(specifierToFile(spec, "src/routes/+page.svelte", rels), null, spec);
  }
});

// The clock bound is sized against a walk that builds every candidate path under
// every directory above the importer for every import, which takes over 30,000 ms
// on these inputs; a lookup that does not grow with the path takes under 100 ms.
test("an alias import from a deep directory resolves in time that does not grow with the path", () => {
  const dir = "a/".repeat(400);
  const half = "a/".repeat(200);
  const rels = corpus(`${dir}X.svelte`, `${half}src/lib/p/q0.ts`, `${half}src/lib/p/dir/index.ts`, `${half}p/v0.ts`);

  const before = performance.now();
  for (let i = 1; i <= 4000; i++) assert.equal(specifierToFile(`$lib/p/q${i}`, `${dir}X.svelte`, rels), null);
  for (let i = 1; i <= 4000; i++) assert.equal(specifierToFile(`@/p/v${i}`, `${dir}X.svelte`, rels), null);
  for (let i = 1; i <= 4000; i++) assert.equal(specifierToFile(`$lib/${"../".repeat(i % 400)}..`, `${dir}X.svelte`, rels), null);
  const took = performance.now() - before;

  assert.equal(specifierToFile("$lib/p/q0", `${dir}X.svelte`, rels), `${half}src/lib/p/q0.ts`);
  assert.equal(specifierToFile("$lib/p/dir/", `${dir}X.svelte`, rels), `${half}src/lib/p/dir/index.ts`);
  assert.equal(specifierToFile("@/p/v0", `${dir}X.svelte`, rels), `${half}p/v0.ts`);
  assert.ok(took < 5000, `12,000 alias imports took ${Math.round(took)} ms`);
});

// A specifier is the repository's text, and a pattern that strips its trailing
// slashes tries every start in a run of them that is not at the end: four times
// the run then costs sixteen times as long, 213 ms and 3,375 ms on these two.
test("a specifier holding a long run of slashes resolves in time linear in the run", () => {
  const rels = corpus("a/b/Page.ts", "x/y.ts");
  const fastest = (run) => {
    const spec = `x${"/".repeat(run)}y`;
    let best = Infinity;
    for (let turn = 0; turn < 3; turn++) {
      const before = performance.now();
      assert.equal(specifierToFile(spec, "a/b/Page.ts", rels), null);
      best = Math.min(best, performance.now() - before);
    }
    return best;
  };

  const short = fastest(20_000);
  const long = fastest(80_000);

  // Under a millisecond the clock measures itself, so the short run is counted as one.
  assert.ok(long / Math.max(short, 1) < 8, `20,000 slashes took ${short.toFixed(2)} ms and 80,000 took ${long.toFixed(2)} ms`);
  assert.equal(specifierToFile("x/y///", "a/b/Page.ts", rels), null, "a trailing run still asks for an index alone");
  assert.equal(specifierToFile("@/x/y///", "a/b/Page.vue", corpus("x/y/index.ts")), "x/y/index.ts");
});

// The other half of the walk the deep-importer test holds: a walk over every
// directory a tail sits under takes over 14,000 ms on these inputs, and one over
// the importer's own three takes under 300 ms.
test("an alias import of a tail tens of thousands of files share resolves in time that does not grow with them", () => {
  const shared = Array.from({ length: 50_000 }, (_, i) => `d${i}/src/lib/p/q.ts`);
  const rels = corpus(...shared, "a/src/lib/p/q.ts", "a/b/X.svelte");

  const before = performance.now();
  for (let i = 0; i < 8000; i++) assert.equal(specifierToFile("$lib/p/q", "a/b/X.svelte", rels), "a/src/lib/p/q.ts");
  const took = performance.now() - before;

  assert.ok(took < 5000, `8,000 alias imports took ${Math.round(took)} ms`);
});

test("an alias that climbs out of its root names what the path names from each directory above the importer", () => {
  const page = "apps/web/src/routes/+page.svelte";

  assert.equal(specifierToFile("$lib/../util", page, corpus("apps/web/src/util.ts")), "apps/web/src/util.ts");
  assert.equal(specifierToFile("$lib/../../../shared/x", page, corpus("apps/shared/x.ts")), "apps/shared/x.ts", "from two directories up");
  assert.equal(specifierToFile("$lib/../../../shared/x", page, corpus("apps/web/src/routes/shared/x.ts")), null, "never under the importer's own directory");
  assert.equal(specifierToFile("$lib/../../../../../../x/y", page, corpus("x/y.ts")), "x/y.ts", "from the repository's top");
  assert.equal(specifierToFile("$lib/../../../../../../../x/y", page, corpus("x/y.ts")), null, "past the repository's top");
  assert.equal(specifierToFile("$lib/../..", page, corpus("apps/web.ts")), "apps/web.ts", "a path that is a directory above the importer");
  assert.equal(specifierToFile("$lib/../..", page, corpus("apps/web/src/index.ts")), "apps/web/src/index.ts");
  assert.equal(specifierToFile("$lib/../../", page, corpus("apps/web.ts", "apps/web/index.ts")), "apps/web/index.ts", "a trailing slash asks for the index alone");
  assert.equal(specifierToFile("$lib/../..", page, corpus("apps/web.ts", "apps/index.ts")), null, "two directories answer");
  assert.equal(specifierToFile("$lib/../../..", page, corpus("apps/web/src/routes.ts")), null, "the walk starts above the importer's directory");
  assert.equal(specifierToFile("$lib/../../..", page, corpus("apps/web/src/routes.ts", "apps/web/src.ts")), "apps/web/src.ts");
  assert.equal(specifierToFile("$lib/../..", "a/X.svelte", corpus(".ts", "index.ts")), null, "the repository's top is no file's name");
  assert.equal(specifierToFile("@//components/./Button.vue", "src/pages/Home.vue", corpus("src/components/Button.vue")), "src/components/Button.vue");
});

test("an alias names the first spelling each directory holds, however many directories end in the path", () => {
  const apps = ["a", "b", "c", "d", "e"].flatMap((app) => [`apps/${app}/src/lib/utils.ts`, `apps/${app}/src/lib/utils/index.ts`]);

  assert.equal(specifierToFile("$lib/utils", "apps/c/x.svelte", corpus(...apps)), "apps/c/src/lib/utils.ts");
  assert.equal(specifierToFile("$lib/utils", "x.svelte", corpus(...apps)), null);
  assert.equal(specifierToFile("$lib/utils", "apps/c/x.svelte", corpus(...apps, "apps/src/lib/utils.js")), null);
});
