import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { blank } from "../plugins/anatomiya/lib/blank.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

test("blanked text keeps its length in UTF-16 units and every line break where it was", () => {
  assert.equal(blank("ab\r\n\tc\rd\n"), "  \r\n  \r \n");
  assert.equal(blank("a\u{1F600}b"), "    ", "an astral character is two units, so two spaces");
  assert.equal(blank(""), "");
});

test("both parser children blank through the one definition, which imports nothing", () => {
  const src = (name) => readFileSync(join(ANATOMIYA, "lib", name), "utf8");
  assert.equal(/^\s*import[\s("'{*]|\brequire\s*\(/m.test(src("blank.mjs")), false);
  for (const name of ["csharp-directives.mjs", "script-blocks.mjs"]) {
    assert.match(src(name), /^import \{ blank \} from "\.\/blank\.mjs";$/m, name);
    assert.equal(src(name).includes("[^\\n\\r]"), false, `${name} spells the pattern again`);
  }
});
