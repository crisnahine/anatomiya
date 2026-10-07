import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

import { GRAMMARS, check, vendor } from "../scripts/grammars.mjs";
import { ANATOMIYA, REL, ROOT } from "../scripts/plugins.mjs";

const IDS = ["python", "php", "go", "java", "csharp", "rust", "kotlin"];
const VENDORED = join(ANATOMIYA, "grammars");
const manifest = () => JSON.parse(readFileSync(join(VENDORED, "grammars.json"), "utf8"));

const SAMPLES = {
  python: "import os\n\nclass A:\n    def f(self):\n        return os.sep\n",
  php: "<?php\nnamespace App;\nclass A {\n    public function f(): int { return 1; }\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(1) }\n",
  java: "package app;\n\nclass A {\n    int f() { return 1; }\n}\n",
  csharp: "namespace App;\n\nclass A {\n    int F() { return 1; }\n}\n",
  rust: "use std::fmt;\n\nstruct A;\n\nfn main() { let _ = A; }\n",
  kotlin: "package app\n\nclass A {\n    fun f(): Int = 1\n}\n",
};

/** A marketplace root holding only what the check reads: the vendored set, the lockfile and each package's wasm. */
async function withCopy(run) {
  const root = mkdtempSync(join(tmpdir(), "anatomiya-grammars-"));
  try {
    cpSync(VENDORED, join(root, REL.anatomiya, "grammars"), { recursive: true });
    cpSync(join(ROOT, "package-lock.json"), join(root, "package-lock.json"));
    for (const { package: name, source } of Object.values(GRAMMARS)) {
      cpSync(join(ROOT, "node_modules", name, source), join(root, "node_modules", name, source));
    }
    return await run(root, join(root, REL.anatomiya, "grammars"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the manifest lists the seven grammars, each under the name it is vendored as", () => {
  assert.deepEqual(Object.keys(GRAMMARS), IDS);
  const entries = manifest();
  assert.deepEqual(entries.map((entry) => entry.id), IDS);
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry), ["id", "package", "version", "source", "file", "sha256", "abi"]);
    assert.equal(entry.file, `${entry.id}.wasm`);
    assert.equal(entry.package, GRAMMARS[entry.id].package);
    assert.equal(entry.source, GRAMMARS[entry.id].source);
  }
  assert.equal(entries.find((entry) => entry.id === "php").source, "tree-sitter-php.wasm", "the php grammar, which reads a file from its open tag, and not php_only");
});

test("every vendored file hashes to its manifest entry", () => {
  for (const entry of manifest()) {
    const sha256 = createHash("sha256").update(readFileSync(join(VENDORED, entry.file))).digest("hex");
    assert.equal(sha256, entry.sha256, entry.file);
  }
});

test("the vendored set is the one the installed packages hold", () => {
  assert.deepEqual(check(ROOT), []);
});

test("a copy of the tree is clean, so each refusal below is the one change made to it", async () => {
  await withCopy((root) => assert.deepEqual(check(root), []));
});

test("a truncated vendored file is refused", async () => {
  await withCopy((root, dir) => {
    writeFileSync(join(dir, "go.wasm"), readFileSync(join(dir, "go.wasm")).subarray(0, 4096));
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /go\.wasm does not hash to its manifest entry/);
  });
});

test("a manifest version the root lockfile does not hold is refused", async () => {
  await withCopy((root, dir) => {
    const entries = JSON.parse(readFileSync(join(dir, "grammars.json"), "utf8"));
    entries.find((entry) => entry.id === "java").version = "0.0.1";
    writeFileSync(join(dir, "grammars.json"), JSON.stringify(entries));
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /tree-sitter-java is 0\.0\.1 in the manifest and 0\.23\.5 in package-lock\.json/);
  });
});

test("an installed package whose wasm is not the vendored one is refused", async () => {
  await withCopy((root) => {
    const { package: name, source } = GRAMMARS.rust;
    writeFileSync(join(root, "node_modules", name, source), "not the grammar");
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /tree-sitter-rust\/tree-sitter-rust\.wasm does not hash to the manifest entry for rust/);
  });
});

test("a package that is not installed is said, not passed over", async () => {
  await withCopy((root) => {
    rmSync(join(root, "node_modules", GRAMMARS.python.package), { recursive: true });
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /tree-sitter-python\/tree-sitter-python\.wasm is not installed/);
  });
});

test("a manifest entry with no file is refused", async () => {
  await withCopy((root, dir) => {
    rmSync(join(dir, "kotlin.wasm"));
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /kotlin\.wasm is in the manifest and not on disk/);
  });
});

test("a file with no manifest entry is refused", async () => {
  await withCopy((root, dir) => {
    writeFileSync(join(dir, "swift.wasm"), "stray");
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /swift\.wasm has no manifest entry/);
  });
});

test("a manifest that dropped a grammar is refused", async () => {
  await withCopy((root, dir) => {
    const entries = JSON.parse(readFileSync(join(dir, "grammars.json"), "utf8")).filter((entry) => entry.id !== "php");
    writeFileSync(join(dir, "grammars.json"), JSON.stringify(entries));
    rmSync(join(dir, "php.wasm"));
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /php has no manifest entry/);
  });
});

test("a manifest that cannot be read is one problem, not a throw", async () => {
  await withCopy((root, dir) => {
    writeFileSync(join(dir, "grammars.json"), "{");
    const problems = check(root);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /grammars\.json could not be read/);
  });
});

test("vendoring from the installed packages writes the manifest that is committed", async () => {
  await withCopy(async (root, dir) => {
    rmSync(dir, { recursive: true });
    await vendor(root);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "grammars.json"), "utf8")), manifest());
    assert.deepEqual(check(root), []);
  });
});

test("every vendored grammar loads, reports the manifest's ABI and reads a sample clean", async () => {
  await Parser.init();
  const parser = new Parser();
  try {
    for (const entry of manifest()) {
      const language = await Language.load(readFileSync(join(VENDORED, entry.file)));
      assert.equal(language.abiVersion, entry.abi, `${entry.id} ABI`);
      parser.setLanguage(language);
      const tree = parser.parse(SAMPLES[entry.id]);
      try {
        assert.equal(tree.rootNode.hasError, false, `${entry.id} sample`);
        assert.ok(tree.rootNode.namedChildCount >= 2, `${entry.id} sample read as code, not as one text node`);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
