import { test } from "node:test";
import assert from "node:assert/strict";

import { reachedFrom } from "../plugins/anatomiya/lib/refs.mjs";

/** What `reachedFrom` makes of each importer in `records`, keyed by the importer's path. */
function reached(records, importers) {
  const corpus = new Set(records.keys());
  return Object.fromEntries(importers.map((rel) => [rel, reachedFrom(rel, records.get(rel), corpus, records)]));
}

const read = (facets) => ({ ok: true, facets });

test("an import of a package the repository does not hold is no file of its own whose path ends the same", () => {
  const records = new Map([
    ["app/src/main/kotlin/com/acme/util/Log.kt", read({ defines: ["Log"], namespace: "com.acme.util" })],
    ["app/src/main/kotlin/com/acme/math/Calc.kt", read({ defines: ["Calc", "max"], namespace: "com.acme.math" })],
    ["app/Support/Str.php", read({ defines: ["Str"], namespace: "App.Support" })],
    ["app/src/main/kotlin/com/acme/ui/Screen.kt", read({ refs: [{ name: "Log", stems: ["android/util/Log"], dir: "android/util", lookup: "Log" }], namespace: "com.acme.ui" })],
    ["app/src/main/kotlin/com/acme/data/Repo.kt", read({ refs: [{ name: "max", stems: ["kotlin/math/max"], dir: "kotlin/math", lookup: "max" }], namespace: "com.acme.data" })],
    ["app/Http/PostController.php", read({ refs: [{ name: "Str", stems: ["Illuminate/Support/Str", "Support/Str"] }], namespace: "App.Http" })],
  ]);
  assert.deepEqual(reached(records, ["app/src/main/kotlin/com/acme/ui/Screen.kt", "app/src/main/kotlin/com/acme/data/Repo.kt", "app/Http/PostController.php"]), {
    "app/src/main/kotlin/com/acme/ui/Screen.kt": [],
    "app/src/main/kotlin/com/acme/data/Repo.kt": [],
    "app/Http/PostController.php": [],
  });
});

test("an import of the repository's own package reaches its file, a source tree that leaves out the package's first names included", () => {
  const records = new Map([
    ["src/util/Log.kt", read({ defines: ["Log"], namespace: "com.acme.util" })],
    ["app/Support/Str.php", read({ defines: ["Str"], namespace: "App.Support" })],
    ["src/ui/Screen.kt", read({ refs: [{ name: "Log", stems: ["com/acme/util/Log"], dir: "com/acme/util", lookup: "Log" }], namespace: "com.acme.ui" })],
    ["app/Http/PostController.php", read({ refs: [{ name: "Str", stems: ["App/Support/Str", "Support/Str"] }], namespace: "App.Http" })],
  ]);
  assert.deepEqual(reached(records, ["src/ui/Screen.kt", "app/Http/PostController.php"]), {
    "src/ui/Screen.kt": [{ file: "src/util/Log.kt", names: ["Log"] }],
    "app/Http/PostController.php": [{ file: "app/Support/Str.php", names: ["Str"] }],
  });
});

test("a class whose method a file calls is named for the method alone, not twice", () => {
  const stems = ["com/acme/Strings"];
  const records = new Map([
    ["src/main/java/com/acme/Strings.java", read({ defines: ["Strings", "isBlank"], namespace: "com.acme" })],
    ["src/main/java/com/acme/web/A.java", read({ refs: [{ name: "Strings", stems }, { name: "Strings.isBlank", bare: "Strings", member: "isBlank", stems }], namespace: "com.acme.web" })],
    // A class named and nothing called on it is the class.
    ["src/main/java/com/acme/web/B.java", read({ refs: [{ name: "Strings", stems }], namespace: "com.acme.web" })],
  ]);
  assert.deepEqual(reached(records, ["src/main/java/com/acme/web/A.java", "src/main/java/com/acme/web/B.java"]), {
    "src/main/java/com/acme/web/A.java": [{ file: "src/main/java/com/acme/Strings.java", names: ["Strings.isBlank"] }],
    "src/main/java/com/acme/web/B.java": [{ file: "src/main/java/com/acme/Strings.java", names: ["Strings"] }],
  });
});

test("an import of a module names no helper, and what is called on it does", () => {
  const records = new Map([
    ["shop/utils/text.py", read({ defines: ["slugify"] })],
    ["shop/utils/__init__.py", read({ defines: [] })],
    ["crates/core/src/util/text.rs", read({ defines: ["escape"] })],
    ["shop/views.py", read({ refs: [{ name: "text", stems: ["shop/utils/text", "shop/utils/text/__init__", "shop/utils", "shop/utils/__init__"] }, { name: "slugify", stems: ["shop/utils/text", "shop/utils/text/__init__"] }] })],
    ["shop/admin.py", read({ refs: [{ name: "utils", stems: ["shop/utils", "shop/utils/__init__", "shop", "shop/__init__"] }] })],
    ["crates/core/src/main.rs", read({ refs: [{ name: "text", stems: ["crates/core/src/util/text", "crates/core/src/util/text/mod"], exact: true }] })],
  ]);
  assert.deepEqual(reached(records, ["shop/views.py", "shop/admin.py", "crates/core/src/main.rs"]), {
    "shop/views.py": [{ file: "shop/utils/text.py", names: ["slugify"] }],
    "shop/admin.py": [],
    "crates/core/src/main.rs": [],
  });
});

test("a Ruby file under a test tree loads nothing by name, so the code it is named for keeps its name", () => {
  const records = new Map([
    ["lib/money.rb", read({ defines: ["format"] })],
    ["spec/lib/money.rb", read({ defines: [] })],
    ["app/models/order.rb", read({ refs: [{ const: "Money", nesting: ["Order"], name: "Money.format" }] })],
  ]);
  assert.deepEqual(reached(records, ["app/models/order.rb"]), { "app/models/order.rb": [{ file: "lib/money.rb", names: ["Money.format"] }] });
});

test("a class a Java wildcard brings in from another package reaches its file, the importer's own package tried first", () => {
  const stems = ["com/acme/app/Strings", "com/acme/util/Strings"];
  const records = new Map([
    ["src/main/java/com/acme/util/Strings.java", read({ defines: ["Strings", "isBlank"], namespace: "com.acme.util" })],
    ["src/main/java/com/acme/app/A.java", read({ refs: [{ name: "Strings.isBlank", bare: "Strings", member: "isBlank", stems }], namespace: "com.acme.app" })],
  ]);
  assert.deepEqual(reached(records, ["src/main/java/com/acme/app/A.java"]), {
    "src/main/java/com/acme/app/A.java": [{ file: "src/main/java/com/acme/util/Strings.java", names: ["Strings.isBlank"] }],
  });
});

test("a Ruby file under a gem's own lib/rack/test is loaded by its name", () => {
  const records = new Map([
    ["lib/rack/test/utils.rb", read({ defines: ["build"] })],
    ["app/models/order.rb", read({ refs: [{ const: "Rack::Test::Utils", nesting: [], name: "Rack::Test::Utils.build" }] })],
  ]);
  assert.deepEqual(reached(records, ["app/models/order.rb"]), { "app/models/order.rb": [{ file: "lib/rack/test/utils.rb", names: ["Rack::Test::Utils.build"] }] });
});

test("a Go import in a repository with no go.mod names no package of its own", () => {
  const records = new Map([
    ["errors/wrap.go", read({ defines: ["Wrap"] })],
    ["cmd/main.go", read({ refs: [{ name: "errors.Wrap", dir: "github.com/pkg/errors", lookup: "Wrap" }] })],
  ]);
  assert.deepEqual(reached(records, ["cmd/main.go"]), { "cmd/main.go": [] });
});
