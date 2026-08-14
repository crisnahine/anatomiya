import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths, needsShebang } from "./platform.mjs";
import { needsRuby } from "./ruby-available.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRuby, walkRuby, constName, bodyOf, RUBY_GUARDS } from "../lib/ruby.mjs";
import { RUBY_DIMENSIONS } from "../lib/dimensions-ruby.mjs";

const dir = mkdtempSync(join(tmpdir(), "anatomiya-ruby-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

function write(name, src) {
  const abs = join(dir, `${name}.rb`);
  writeFileSync(abs, src);
  return { rel: `${name}.rb`, abs };
}

/**
 * Every fixture is parsed in one child process. A spawn per test would make
 * the suite pay the interpreter's start-up cost twenty times over to prove
 * nothing about it.
 */
const SRC = {
  rescue_swallowed: `
    begin
      a
    rescue => e
      nil
    end
    begin
      b
    rescue => e
      log(e)
    end
  `,
  rescue_reraise: `
    begin
      a
    rescue ActiveRecord::RecordNotFound
      raise Wrapped
    end
  `,
  rescue_method_named_like_error: `
    begin
      a
    rescue => e
      other.e
    end
  `,
  rescue_none: `
    def go
      work
    end
  `,

  lookup_mixed: `
    class Reader
      def go(id)
        User.find(id)
        User.find_by(id: id)
        Account.find_by!(id: id)
      end
    end
  `,
  lookup_enumerable: `
    def pick(items)
      STATUSES.find { |s| s == :open }
      items.find { |i| i.open? }
    end
  `,

  model_with_callback: `
    class Listing < ApplicationRecord
      before_save :normalise
      def touch_it
        after_save_hook
      end
    end
  `,
  model_plain: `
    class Offer < ActiveRecord::Base
      validates :amount, presence: true
    end
  `,
  model_callback_in_method: `
    class Sale < ApplicationRecord
      def republish
        after_commit :notify
      end
    end
  `,
  model_none: `
    class PlainService
      before_save :normalise
    end
  `,

  service_raises: `
    class Charge
      def call
        raise ArgumentError, "no"
      end
    end
  `,
  service_returns: `
    class Refund
      def call
        return failure(:missing) unless record
        success(record)
      end
    end
  `,
  service_translates: `
    class Sync
      def perform
        begin
          remote
        rescue Timeout::Error
          raise SyncFailed
        end
      end
    end
  `,
  service_not_entry: `
    class Report
      def build
        raise "no"
      end
    end
  `,

  params_positional: `
    def send_mail(to, from, subject)
    end
  `,
  params_keyword: `
    def send_mail(to:, from:, subject: nil)
    end
  `,
  params_two: `
    def pair(a, b)
    end
  `,

  time_naive: `
    def stamp
      Time.now
      Date.today
      DateTime.now
    end
  `,
  time_zoned: `
    def stamp
      Time.current
      Time.zone.now
      Date.current
    end
  `,
  time_chained: `
    def stamp
      Time.zone.now.beginning_of_day
    end
  `,
  time_none: `
    def stamp
      clock.read
    end
  `,

  scopes: `
    class Outer
      def run
        [1].each do |i|
          Time.now
        end
      end
    end
  `,
  utf8: `
    # el niño paga en €
    def greet
      "añejo — ✅"
    end
  `,
};

const parsed = await parseRuby(Object.entries(SRC).map(([name, src]) => write(name, src)));
const programs = new Map(parsed.results.map((r) => [r.rel.replace(/\.rb$/, ""), r]));

const dim = (key) => RUBY_DIMENSIONS.find((d) => d.key === key);

function hits(key, name) {
  const file = programs.get(name);
  assert.ok(file && file.ok, `${name} did not parse: ${file && file.error}`);
  const out = [];
  dim(key).run(file.program, (h) => out.push(h));
  return out;
}

const counts = (key, name) => {
  const h = hits(key, name);
  return { candidates: h.length, conforming: h.filter((x) => x.conforming).length };
};

// --- the parser itself ---

test("every fixture parsed, through one child process", needsRuby, () => {
  assert.equal(parsed.results.length, Object.keys(SRC).length);
  assert.equal(parsed.crashed, 0);
  assert.equal(parsed.error, null);
  assert.ok(parsed.engine, "the child reports which prism it loaded");
});

test("the tree carries no byte offsets, so none can index the wrong string", needsRuby, () => {
  // prism counts UTF-8 bytes and oxc counts UTF-16 code units. Nothing here
  // can mix them because nothing here is an offset.
  const seen = new Set();
  for (const file of programs.values()) {
    walkRuby(file.program, (n) => {
      for (const k of Object.keys(n)) seen.add(k);
    });
  }
  assert.ok(seen.has("line"), "a hit still has to be able to name where it is");
  for (const k of seen) {
    assert.ok(!/(^|_)(loc|location|offset|start|end)$/.test(k), `${k} is an offset`);
  }
});

test("no files is an empty run, not a spawn", needsRuby, async () => {
  const out = await parseRuby([]);
  assert.deepEqual(out.results, []);
  assert.equal(out.parsed, 0);
  assert.equal(out.engine, null, "nothing was started, so nothing reported a version");
  assert.equal(out.error, null);
});

test("onFile hands each result over and retains none", needsRuby, async () => {
  const streamed = [];
  const out = await parseRuby([{ rel: "here.rb", abs: join(dir, "rescue_none.rb") }], {
    onFile: (r) => streamed.push(r),
  });
  assert.equal(streamed.length, 1);
  assert.equal(streamed[0].ok, true);
  assert.deepEqual(out.results, [], "a Rails-sized corpus must not be held in memory");
  assert.equal(out.parsed, 1, "the counters still move when nothing is retained");
});

test("a newline in a path is a path, not two paths", needsPosixPaths, needsRuby, async () => {
  const abs = join(dir, "two\nlines.rb");
  writeFileSync(abs, "def go\n  Time.now\nend\n");
  const out = await parseRuby([{ rel: "two\nlines.rb", abs }]);
  assert.equal(out.results.length, 1, "paths travel on stdin NUL-delimited, never split on newline");
  assert.equal(out.results[0].rel, "two\nlines.rb");
  assert.equal(out.results[0].ok, true);
});

test("a file over the size cap is skipped without a tree", needsRuby, async () => {
  const big = write("big", `x = "${"a".repeat(5 * 1024 * 1024)}"\n`);
  const out = await parseRuby([big]);
  assert.equal(out.results[0].ok, false);
  assert.equal(out.results[0].skipped, true);
  assert.equal(out.results[0].program, null);
  assert.equal(out.parsed, 0);
});

test("one unreadable file costs that file, not the run", needsRuby, async () => {
  const out = await parseRuby([
    { rel: "gone.rb", abs: join(dir, "does-not-exist.rb") },
    { rel: "here.rb", abs: join(dir, "rescue_none.rb") },
  ]);
  assert.equal(out.results.length, 2);
  assert.equal(out.results.find((r) => r.rel === "gone.rb").ok, false);
  assert.equal(out.results.find((r) => r.rel === "here.rb").ok, true);
});

test("a path that would need argv quoting never reaches the parser", needsRuby, async () => {
  const out = await parseRuby([{ rel: "-rsocket.rb", abs: join(dir, "-rsocket.rb") }]);
  assert.equal(out.results[0].skipped, true);
  assert.equal(out.results[0].ok, false);
  assert.equal(out.engine, null, "the interpreter never started, so the path never reached it");
});

test("no ruby on the machine charges the files instead of losing them", needsRuby, async () => {
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    ruby: "anatomiya-no-such-ruby",
  });
  assert.ok(out.error, "the reason is reported, not swallowed");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
});

test("a parser too old for these field names reports rather than counting zero", needsShebang, async () => {
  // The stub stands in for a Ruby whose prism spells the fields differently.
  const stub = join(dir, "old-ruby");
  writeFileSync(stub, '#!/bin/sh\necho \'{"fatal":"prism 0.19.0 predates it"}\'\n', { mode: 0o755 });
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], { ruby: stub });
  assert.match(out.error, /prism 0\.19\.0/);
  assert.equal(out.parsed, 0);
  assert.equal(out.results[0].crashed, true, "the file is charged, not silently dropped");
});

test("silence past the idle window ends the run and charges what never answered", needsRuby, async () => {
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    guards: { ...RUBY_GUARDS, idleMs: 1 },
  });
  assert.equal(out.error, "ruby went silent");
  assert.equal(out.results[0].crashed, true);
});

test("total output is not capped, so repository size alone never truncates", needsRuby, async () => {
  // The stream is drained a line at a time, so a large repository costs time
  // and not memory. A cumulative cap here suppressed every directive in the
  // map for the repositories that most need one.
  assert.equal(RUBY_GUARDS.totalBytes, undefined, "a cumulative output cap is a size limit on the repository");

  const files = Array.from({ length: 40 }, (_, i) => ({ rel: `a${i}.rb`, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files);

  assert.equal(out.truncated, false);
  assert.equal(out.parsed, 40, "every file answered");
});

test("one enormous line still stops the run, because V8 refuses to hold the string", needsRuby, async () => {
  // The guard reads the undrained buffer, so it only sees a line that spans
  // stdout chunks. 2,000 statements is roughly 400 KB of JSON against a 64 KB
  // pipe chunk; a small fixture arrives whole and drains before the check.
  const big = write("huge", Array.from({ length: 2000 }, (_, i) => `X${i} = Time.zone.now`).join("\n") + "\n");
  const out = await parseRuby([big], { guards: { ...RUBY_GUARDS, maxLineBytes: 8 } });

  assert.equal(out.truncated, true, "the caller must suppress every directive on this");
  assert.equal(out.parsed, 0, "nothing was counted from a run that stopped mid-line");
});

test("broken syntax is reported as unread, not counted from the recovery", needsRuby, async () => {
  // prism recovers further than oxc does, so the salvaged tree holds nodes
  // nobody wrote. This file used to answer ok with a conforming
  // service_result_shape site, from a method that has no body to look at.
  const out = await parseRuby([write("broken", "class Foo\n  def call(\n")], {
    dimensions: RUBY_DIMENSIONS,
  });

  assert.equal(out.results[0].ok, false, "a file the parser could not read is not examined");
  assert.ok(out.results[0].errors > 0, "and the count says why");
  assert.equal(out.results[0].hits, undefined, "nothing is counted from the recovery");
});

test("scope attribution resolves to the innermost declaration, not the block", needsRuby, () => {
  let where = "unset";
  walkRuby(programs.get("scopes").program, (n, ctx) => {
    if (n.t === "call" && n.name === "now") where = [ctx.def && ctx.def.name, ctx.cls && ctx.cls.name];
  });
  assert.deepEqual(where, ["run", "Outer"], "a block does not shadow the method it sits in");
});

test("a namespaced constant reads back as its dotted name", needsRuby, () => {
  let name = null;
  walkRuby(programs.get("rescue_reraise").program, (n) => {
    if (n.t === "constant_path") name = constName(n);
  });
  assert.equal(name, "ActiveRecord::RecordNotFound");
});

test("a receiver that is not a constant reads back as no name at all", needsRuby, () => {
  assert.equal(constName(null), null);
  assert.equal(constName({ t: "call", name: "zone" }), null, "a method call is not a constant");
});

test("a body reads back the same whether or not prism wrapped it", needsRuby, () => {
  const call = { t: "call", name: "go" };
  assert.deepEqual(bodyOf({ body: { t: "statements", body: [call] } }), [call]);
  assert.deepEqual(bodyOf({ body: call }), [call], "a lone statement is still one statement");
  assert.deepEqual(bodyOf({ body: { t: "statements" } }), []);
  assert.deepEqual(bodyOf({}), []);
  assert.deepEqual(bodyOf(null), []);
});

test("a file the parser gave no tree for walks to nothing rather than throwing", needsRuby, () => {
  let visits = 0;
  walkRuby(null, () => visits++);
  walkRuby({ t: "call", name: "go", receiver: null, arguments: [] }, () => visits++);
  assert.equal(visits, 1, "a null tree is the shape a failed parse hands the dimensions");
});

// --- rescue_uses_error ---

test("a rescue that drops the error is a violation, one that reads it is not", needsRuby, () => {
  assert.deepEqual(counts("rescue_uses_error", "rescue_swallowed"), {
    candidates: 2,
    conforming: 1,
  });
});

test("a re-raise counts as handled even with nothing bound", needsRuby, () => {
  assert.deepEqual(counts("rescue_uses_error", "rescue_reraise"), {
    candidates: 1,
    conforming: 1,
  });
});

test("a method that happens to be named like the binding is not a use of it", needsRuby, () => {
  const r = counts("rescue_uses_error", "rescue_method_named_like_error");
  assert.equal(r.candidates, 1);
  assert.equal(r.conforming, 0, "other.e reads a method, not the caught error");
});

test("a file with no rescue contributes nothing", needsRuby, () => {
  assert.equal(hits("rescue_uses_error", "rescue_none").length, 0);
});

// --- record_lookup ---

test("find is a violation and find_by conforms, bang included", needsRuby, () => {
  const r = counts("record_lookup", "lookup_mixed");
  assert.equal(r.candidates, 3);
  assert.equal(r.conforming, 1, "find and find_by! both raise on a miss");
});

test("Enumerable#find is a different method and is not counted", needsRuby, () => {
  assert.equal(hits("record_lookup", "lookup_enumerable").length, 0);
});

// --- model_callbacks ---

test("a model registering a lifecycle callback is the violation", needsRuby, () => {
  assert.deepEqual(counts("model_callbacks", "model_with_callback"), {
    candidates: 1,
    conforming: 0,
  });
});

test("a model with no callback is one conforming site, not zero", needsRuby, () => {
  assert.deepEqual(counts("model_callbacks", "model_plain"), { candidates: 1, conforming: 1 });
});

test("a callback name called inside a method is not a registration", needsRuby, () => {
  assert.deepEqual(counts("model_callbacks", "model_callback_in_method"), {
    candidates: 1,
    conforming: 1,
  });
});

test("a class that is not a model contributes nothing", needsRuby, () => {
  assert.equal(hits("model_callbacks", "model_none").length, 0);
});

// --- service_result_shape ---

test("an entry point that raises is a violation and one that returns conforms", needsRuby, () => {
  assert.deepEqual(counts("service_result_shape", "service_raises"), {
    candidates: 1,
    conforming: 0,
  });
  assert.deepEqual(counts("service_result_shape", "service_returns"), {
    candidates: 1,
    conforming: 1,
  });
});

test("a raise inside a rescue translates someone else's error and is not counted", needsRuby, () => {
  assert.deepEqual(counts("service_result_shape", "service_translates"), {
    candidates: 1,
    conforming: 1,
  });
});

test("a method that is not an entry point contributes nothing", needsRuby, () => {
  assert.equal(hits("service_result_shape", "service_not_entry").length, 0);
});

// --- keyword_params ---

test("three positional arguments is the violation and three keywords conform", needsRuby, () => {
  assert.deepEqual(counts("keyword_params", "params_positional"), {
    candidates: 1,
    conforming: 0,
  });
  assert.deepEqual(counts("keyword_params", "params_keyword"), { candidates: 1, conforming: 1 });
});

test("two arguments are below the threshold and are not candidates", needsRuby, () => {
  assert.equal(hits("keyword_params", "params_two").length, 0);
});

// --- zone_aware_time ---

test("Time.now, Date.today and DateTime.now are the three violations", needsRuby, () => {
  assert.deepEqual(counts("zone_aware_time", "time_naive"), { candidates: 3, conforming: 0 });
});

test("Time.current, Time.zone.now and Date.current conform", needsRuby, () => {
  assert.deepEqual(counts("zone_aware_time", "time_zoned"), { candidates: 3, conforming: 3 });
});

test("a chained read counts once, not once per link", needsRuby, () => {
  assert.deepEqual(counts("zone_aware_time", "time_chained"), { candidates: 1, conforming: 1 });
});

test("a file that never reads the clock contributes nothing", needsRuby, () => {
  assert.equal(hits("zone_aware_time", "time_none").length, 0);
});

// --- the shape the reducer relies on ---

test("every shipped ruby dimension declares its precision and its language", needsRuby, () => {
  for (const d of RUBY_DIMENSIONS) {
    assert.ok(["precise", "partial"].includes(d.precision), d.key);
    assert.deepEqual(d.langs, ["ruby"], d.key);
    assert.ok(d.claim && d.claim.length > 10, `${d.key} needs a readable claim`);
  }
});

test("a dimension only ever calls add with what the reducer reads", needsRuby, () => {
  for (const d of RUBY_DIMENSIONS) {
    let fired = 0;
    for (const name of programs.keys()) {
      d.run(programs.get(name).program, (h) => {
        fired++;
        const at = `${d.key} on ${name}`;
        assert.equal(typeof h.conforming, "boolean", at);
        assert.ok(h.where === null || typeof h.where === "string", at);
        // check.mjs destructures hit.node on every hit and reads type, name and
        // line off it. A ruby hit without one throws there, not here.
        assert.ok(h.node && typeof h.node === "object", `${at} emitted no node`);
        assert.equal(typeof h.node.type, "string", at);
        assert.ok(h.node.name === null || typeof h.node.name === "string", at);
        assert.ok(typeof h.node.line === "number" && h.node.line > 0, at);
        // B5: an offset here would be a UTF-8 byte count handed to a slice of a
        // UTF-16 string.
        assert.notEqual(typeof h.node.start, "number", at);
        assert.notEqual(typeof h.node.end, "number", at);
      });
    }
    assert.ok(fired > 0, `${d.key} never fired, so no fixture holds it to this shape`);
  }
});
