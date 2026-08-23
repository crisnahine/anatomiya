import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths, needsShebang } from "./platform.mjs";
import { needsRuby } from "./ruby-available.mjs";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRuby, RUBY_GUARDS } from "../plugins/anatomiya/lib/ruby.mjs";
import { walkRuby, constName, bodyOf } from "../plugins/anatomiya/lib/ruby-walk.mjs";
import { RUBY_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-ruby.mjs";

const dir = mkdtempSync(join(tmpdir(), "anatomiya-ruby-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

test("a mistyped size override refuses loudly instead of dying inside the child", async () => {
  // Ungated: the refusal happens before any interpreter is spawned. `null` is
  // the sharp half, because `Number(null)` is a finite zero and interpolated
  // it marks every file over the cap without a word.
  for (const bad of ["abc", null]) {
    await assert.rejects(
      parseRuby([{ rel: "a.rb", abs: "/nowhere/a.rb", lang: "ruby" }], { guards: { maxBytes: bad } }),
      /maxBytes/,
      JSON.stringify(bad)
    );
  }
});

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

  log_mixed: `
    def work
      puts "starting"
      logger.info("started")
      Rails.logger.warn("careful")
      p result
    end
  `,
  log_wrapped: `
    class Job
      def run
        @logger.debug("x")
      end
    end
  `,
  http_mixed: `
    class Sync
      def run
        Net::HTTP.get(uri)
        URI.open("https://x")
        ApiClient.get("/x")
        client.post("/y")
      end
    end
  `,

  http_raw_block: `
    def fetch_all
      Net::HTTP.start(url) do |http|
        http.request(req)
      end
    end
  `,
  http_model: `
    class Order
      def sync
        Client.find(3)
        client.update(name: "x")
        ApiClient.get("/x")
      end
    end
  `,

  mixins: `
    class Worker < ApplicationJob
      include Sidekiq::Worker

      def perform
        include Ignored
      end
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

  ruby_error_subclasses: `
    class QuotaExceededError < StandardError
    end
    class MissingFile < Errno::ENOENT
    end
    class ClassifyTransaction < ActiveInteraction::Base
    end
  `,
  local_error_base: `
    class AppError < StandardError
    end
    class QuotaError < AppError
    end
  `,
  namespaced_base: `
    module Api
      module V1
        class BaseController < ActionController::Base
        end
      end
    end
  `,
  pathed_base: `
    class Api::V1::OtherController < ActionController::Base
    end
  `,

  sidekiq_worker: `
    class SendDigestWorker
      include Sidekiq::Worker

      def perform(user_id, digest_id, force)
      end
    end
  `,
  sidekiq_include_below: `
    class LateWorker
      def perform(a, b, c)
      end

      include Sidekiq::Job
    end
  `,
  each_validator: `
    class EmailValidator < ActiveModel::EachValidator
      def validate_each(record, attribute, value)
      end
    end
  `,
  index_assign: `
    class Store
      def []=(a, b, c)
      end
    end
  `,
  bare_class: `
    class TmpPlain
      def name; end
    end
  `,
  struct_super: `
    class TmpOdd < Struct.new(:a)
    end
  `,
  migration_indexed_super: `
    class AddThing < ActiveRecord::Migration[7.2]
      def change; end
    end
  `,
  nested_and_reopened: `
    class Outer < ApplicationRecord
      class Helper
      end
    end
    class Outer
      def extra; end
    end
    module Namespacing
    end
  `,

  time_fixed_offset: `
    def go
      DateTime.new(2026, 8, 20, 9, 0, 0, 'PST')
      Time.new(2026, 8, 20, 9, 0, 0, '-08:00')
    end
  `,
  time_zone_built: `
    def go
      Time.zone.local(2026, 8, 20)
      Time.zone.parse("2026-08-20")
    end
  `,
  service_rollback: `
    class Charge
      def call
        ActiveRecord::Base.transaction do
          raise ActiveRecord::Rollback if bad?
        end
        success
      end
    end
  `,
  service_rollback_and_raise: `
    class Charge
      def call
        ActiveRecord::Base.transaction do
          raise ActiveRecord::Rollback if bad?
        end
        raise ChargeFailed
      end
    end
  `,

  active_job_perform: `
    class SendMailJob < ApplicationJob
      def perform(a, b, c)
      end
    end
  `,
  nested_include: `
module Api
  module V1
    class Widget
      include Trackable
    end
  end
end
`,
  compact_bodies: `
module A2::B2
  class D
    include Concern
  end
end

class A3::B3::E
  include Concern
end
`,
  compact_superclass: `
module Api
  module V1
    class BaseController
    end
  end
end

class Api::V1::QboController < BaseController
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
  assert.ok(parsed.version, "the child reports which prism it loaded");
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
  assert.equal(out.version, null, "nothing was started, so nothing reported a version");
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
  assert.equal(out.version, null, "the interpreter never started, so the path never reached it");
});

test("no ruby on the machine charges the files instead of losing them", needsRuby, async () => {
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    ruby: "anatomiya-no-such-ruby",
  });
  assert.ok(out.error, "the reason is reported, not swallowed");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
});

test("an absent interpreter is reported as a missing parser, not as files that crashed", needsRuby, async () => {
  // The two are different facts with different fixes, and the JS bridge already
  // tells them apart: an absent dependency is every file at once and is an
  // install problem, a crash is one file. Without the flag every caller sees a
  // repository whose Ruby all crashed, which is what a poison file looks like,
  // and a `check` run on a machine with no ruby reported that it found nothing.
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    ruby: "anatomiya-no-such-ruby",
  });

  assert.equal(out.results[0].missingParser, true);
  assert.match(out.results[0].error, /anatomiya-no-such-ruby/);
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

test("a child that keeps answering forever still ends at the wall clock", needsRuby, async () => {
  // F5: silence is not the only way a subprocess fails to end. A child that
  // answers one file every fourteen seconds keeps the idle timer happy and
  // never finishes, and every subprocess here owes a timeout rather than a
  // liveness check.
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    guards: { wallBaseMs: 1, wallPerFileMs: 0 },
  });

  assert.equal(out.error, "ruby ran past its wall clock");
  assert.equal(out.results[0].crashed, true, "what never answered is charged, not dropped");
});

/**
 * A stub interpreter that counts its own runs and records what it was handed.
 *
 * Run 0 does `first` instead of answering; every run after it answers every
 * path on its stdin. The counter is a file rather than an environment variable
 * because the bridge hands the child a stripped environment.
 *
 * The warm-up run is what keeps the idle window below meaningful: macOS spends
 * about 400ms on the first exec of a newly written file and about 5ms on the
 * next, so a cold stub trips a short idle guard before it runs a line.
 */
function retryStub(home, first, afterAnswers = []) {
  const path = join(home, "ruby");
  const script = [
    "#!/bin/sh",
    `if [ "$1" = "--warm" ]; then exit 0; fi`,
    `n=$(cat '${home}/runs' 2>/dev/null || echo 0)`,
    `echo $((n + 1)) > '${home}/runs'`,
    `tr '\\0' '\\n' > '${home}/in.'$n`,
    `printf '{"ready":true,"prism":"1.0.0"}\\n'`,
    `if [ "$n" = "0" ]; then`,
    ...first,
    "  exit 0",
    "fi",
    "while IFS= read -r rel && IFS= read -r abs; do",
    `  printf '{"rel":"%s","ok":true,"errors":0,"length":1,"ast":{"t":"program","line":1}}\\n' "$rel"`,
    `done < '${home}/in.'$n`,
    ...afterAnswers,
    "",
  ].join("\n");
  writeFileSync(path, script, { mode: 0o755 });
  execFileSync(path, ["--warm"]);
  return path;
}

const answer = (rel) =>
  `  printf '{"rel":"%s","ok":true,"errors":0,"length":1,"ast":{"t":"program","line":1}}\\n' ${rel}`;

test("a child our own timer killed is spawned once more for what never answered", needsShebang, async () => {
  // The overview has to be byte-stable across scans, and how long a parse takes
  // is a property of the machine: a file charged as crashed in one scan and
  // parsed in the next moves what every reader loads.
  const home = mkdtempSync(join(dir, "retry-"));
  const stub = retryStub(home, ["  sleep 30"]);

  const files = ["a.rb", "b.rb", "c.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: stub, guards: { idleMs: 1500 } });

  assert.equal(out.error, null, "the second child answered, so the run did not fail");
  assert.equal(out.parsed, 3);
  assert.equal(out.crashed, 0);
  assert.deepEqual(out.results.map((r) => r.attempts), [2, 2, 2]);
  assert.equal(readFileSync(join(home, "runs"), "utf8").trim(), "2", "one more child, not a loop");
});

test("the second child is handed only what the first never answered", needsShebang, async () => {
  const home = mkdtempSync(join(dir, "retry-partial-"));
  const stub = retryStub(home, [answer('"a.rb"'), "  sleep 30"]);

  const files = ["a.rb", "b.rb", "c.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: stub, guards: { idleMs: 1500 } });

  assert.equal(out.parsed, 3);
  const attempts = new Map(out.results.map((r) => [r.rel, r.attempts]));
  assert.deepEqual([...attempts], [["a.rb", 1], ["b.rb", 2], ["c.rb", 2]]);
  // Every other line, since the paths arrive as rel and abs pairs.
  const handed = readFileSync(join(home, "in.1"), "utf8").split("\n").slice(0, -1);
  assert.deepEqual(handed.filter((_, i) => i % 2 === 0), ["b.rb", "c.rb"], "an answered file is not sent twice");
});

test("a retry killed after answering everything is not a failed run", needsShebang, async () => {
  // A loaded machine can trip the idle guard after the answers are already in
  // the pipe. Every file parsed, so there is no failure to report.
  const home = mkdtempSync(join(dir, "retry-slowexit-"));
  const stub = retryStub(home, ["  sleep 30"], ["  sleep 30"]);

  const files = ["a.rb", "b.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: stub, guards: { idleMs: 1500 } });

  assert.equal(out.parsed, 2);
  assert.equal(out.crashed, 0);
  assert.equal(out.error, null, "a run whose every file answered did not fail");
});

test("a file the retry left unanswered is charged with what killed the first child", needsShebang, async () => {
  // The retry starts with a clean error so its own ending is what it reports,
  // and a second child that answers nothing and exits 0 leaves nothing to say.
  // What happened is still the first kill, and "no result" names no cause.
  const home = mkdtempSync(join(dir, "retry-silent-"));
  const stub = join(home, "ruby");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      `if [ "$1" = "--warm" ]; then exit 0; fi`,
      `n=$(cat '${home}/runs' 2>/dev/null || echo 0)`,
      `echo $((n + 1)) > '${home}/runs'`,
      `tr '\\0' '\\n' > '${home}/in.'$n`,
      `printf '{"ready":true,"prism":"1.0.0"}\\n'`,
      `if [ "$n" = "0" ]; then sleep 30; fi`,
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  execFileSync(stub, ["--warm"]);

  const files = ["a.rb", "b.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: stub, guards: { idleMs: 1500 } });

  assert.equal(readFileSync(join(home, "runs"), "utf8").trim(), "2", "the first child was killed by our own timer");
  assert.equal(out.crashed, 2);
  assert.deepEqual(out.results.map((r) => r.attempts), [2, 2]);
  assert.deepEqual(out.results.map((r) => r.error), ["ruby went silent", "ruby went silent"]);
});

test("a child that died by itself is charged, not tried again", needsShebang, async () => {
  // The other half of the ruling. An interpreter that exits on its own is a
  // broken install or a fatal from the script, and a second child answers it
  // the same way at twice the cost.
  const home = mkdtempSync(join(dir, "no-retry-"));
  const script = ["#!/bin/sh", `echo x >> '${home}/runs'`, "cat > /dev/null", "exit 1", ""].join("\n");
  writeFileSync(join(home, "ruby"), script, { mode: 0o755 });

  const files = ["a.rb", "b.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: join(home, "ruby") });

  assert.equal(readFileSync(join(home, "runs"), "utf8"), "x\n", "one child, no second one");
  assert.equal(out.parsed, 0);
  assert.equal(out.crashed, 2);
  assert.deepEqual(out.results.map((r) => r.attempts), [1, 1]);
  assert.equal(out.results[0].crashed, true);
  assert.equal(out.missingParser, null, "an interpreter that ran is not an absent one");
  assert.match(out.error, /exited 1/);
});

test("the wall clock is derived from how much work was handed over", needsRuby, () => {
  // A large repository legitimately runs for minutes, so a fixed ceiling would
  // cut off the repositories the map is most worth building for.
  assert.ok(RUBY_GUARDS.wallBaseMs >= 60_000, "a small repository gets a full minute");
  assert.ok(RUBY_GUARDS.wallPerFileMs > 0, "and a large one gets more");
  // Measured at 6,867 files/sec, so this is far past what a real corpus needs.
  const forRails = RUBY_GUARDS.wallBaseMs + RUBY_GUARDS.wallPerFileMs * 5_500;
  assert.ok(forRails > 200_000, `${forRails}ms is not enough for a Rails-sized corpus`);
});

test("overriding one guard keeps the rest", needsRuby, async () => {
  // A caller that replaced the whole object left every guard it did not name
  // undefined, and a timer set from one of those fires at once rather than
  // never.
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    guards: { idleMs: 20_000 },
  });

  assert.equal(out.error, null, "the wall clock it did not name still held off");
  assert.equal(out.parsed, 1);
});

test("a guard named as undefined keeps its default", needsRuby, async () => {
  // Naming a guard and naming nothing are the same gesture from a caller
  // building an override object, and a spread copies the second over the
  // default. A wall clock built from `undefined` fires at once rather than
  // never, which charges every file as crashed on a run that was fine.
  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], {
    guards: { wallBaseMs: undefined, idleMs: undefined },
  });

  assert.equal(out.error, null);
  assert.equal(out.parsed, 1);
});

// --- capability routing, Ruby side ---

test("puts and friends are direct sites and logger calls conform", needsRuby, () => {
  assert.deepEqual(counts("logger_over_puts", "log_mixed"), { candidates: 4, conforming: 2 });
});

test("an instance-variable logger conforms too", needsRuby, () => {
  assert.deepEqual(counts("logger_over_puts", "log_wrapped"), { candidates: 1, conforming: 1 });
});

test("Net::HTTP and URI.open are direct sites and client calls conform", needsRuby, () => {
  assert.deepEqual(counts("http_through_client", "http_mixed"), { candidates: 4, conforming: 2 });
});

test("an ActiveRecord-shaped call on a client-named constant is not an HTTP site", needsRuby, () => {
  assert.deepEqual(counts("http_through_client", "http_model"), { candidates: 1, conforming: 1 });
});

test("a raw Net::HTTP block handle named http is not a conforming client", needsRuby, () => {
  assert.deepEqual(counts("http_through_client", "http_raw_block"), { candidates: 1, conforming: 0 },
    "only the Net::HTTP.start site counts, and it counts against");
});

/* --- class_base: Ruby refuses to raise a class that is not an Exception (#58) --- */

test("an exception subclass is not a class_base site", needsRuby, () => {
  // `ruby -e 'class FakeBase; end; class E < FakeBase; end; raise E'` answers
  // `TypeError: exception class/object expected`, so conforming makes the class
  // unraisable. Every Rails service directory grows error classes, so a perfect
  // baseline made the next one a MUST-FIX.
  const h = hits("class_base", "ruby_error_subclasses");

  assert.deepEqual(h.map((x) => x.where), ["ClassifyTransaction"], JSON.stringify(h.map((x) => x.class)));
});

test("a repository's own error base keeps its subclasses as sites", needsRuby, () => {
  // Only the language's own, so a repository that gives its errors a base of
  // their own keeps every subclass and the row still states there.
  const h = hits("class_base", "local_error_base");

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["QuotaError", "AppError"]]);
});

test("a class carries its own qualified name, whichever way its namespace is spelled", needsRuby, () => {
  // The self-base exclusion needs the learned class, so it lives in the fold;
  // what the predicate owes it is the site's own name.
  assert.deepEqual(hits("class_base", "namespaced_base").map((x) => x.self), ["Api::V1::BaseController"]);
  assert.deepEqual(hits("class_base", "pathed_base").map((x) => x.self), ["Api::V1::OtherController"]);
});

/* --- keyword_params counts only what its caller could reach with keywords (#61) --- */

test("a Sidekiq perform is not a keyword_params site, whichever side of it the include sits", needsRuby, () => {
  // Sidekiq reaches it through `instance.perform(*cloned_args)`, a splat of a
  // JSON array, and in Ruby 3 a splatted Hash is never keywords: enqueueing
  // raises "Job arguments must be native JSON types" and executing raises
  // "wrong number of arguments (given 1, expected 0; required keywords: ...)".
  assert.deepEqual(hits("keyword_params", "sidekiq_worker"), []);
  assert.deepEqual(hits("keyword_params", "sidekiq_include_below"), []);
});

test("an ActiveJob perform is still a site, because ActiveJob carries keywords through", needsRuby, () => {
  // Gated on the mixin rather than on the name: `perform` is an ordinary
  // method name and ActiveJob does pass keywords.
  assert.deepEqual(hits("keyword_params", "active_job_perform").map((h) => h.where), ["perform"]);
});

test("validate_each and []= are never keyword_params sites", needsRuby, () => {
  // `EachValidator#validate` calls `validate_each(record, attribute, value)`
  // positionally, and `s[a: 1] = 2` does not parse at all: "unexpected keyword
  // arg given in index assignment".
  assert.deepEqual(hits("keyword_params", "each_validator"), []);
  assert.deepEqual(hits("keyword_params", "index_assign"), []);
});

/* --- zone_aware_time sees fixed-offset construction (#74b) --- */

test("a fixed-offset construction is a zone_aware_time violation", needsRuby, () => {
  // `DateTime.new(2026, 8, 20, 9, 0, 0, 'PST')` always resolves to UTC-08:00
  // and `Time.new(..., '-08:00')` reports utc_offset -28800, so the app's zone
  // never reaches the value. A bare `Time.new` is `Time.now` under another name.
  assert.deepEqual(counts("zone_aware_time", "time_fixed_offset"), { candidates: 2, conforming: 0 });
});

test("a time built through the app zone conforms, however it is built", needsRuby, () => {
  // Without this a repository that builds its times the right way reads as
  // having no conforming construction at all.
  assert.deepEqual(counts("zone_aware_time", "time_zone_built"), { candidates: 2, conforming: 2 });
});

/* --- service_result_shape does not read a rollback as a raised failure (#74c) --- */

test("raise ActiveRecord::Rollback is control flow inside a transaction, not a raised failure", needsRuby, () => {
  // The block swallows it and the method still returns, so reading it as a
  // service raising its failure is a wrong finding.
  assert.deepEqual(counts("service_result_shape", "service_rollback"), { candidates: 1, conforming: 1 });
});

test("a method that also raises an ordinary error is still a violation", needsRuby, () => {
  assert.deepEqual(counts("service_result_shape", "service_rollback_and_raise"), { candidates: 1, conforming: 0 });
});

/* --- a class that names no superclass is the omission class_base could not see (#54) --- */

test("a bare top-level class is a class_base site conforming to no base", needsRuby, () => {
  // The strongest reading of "things in app/models are ActiveRecord models" was
  // the one the check could not enforce, and the realistic violation is the
  // omission: an agent drops a PORO into app/models rather than inheriting the
  // wrong base. The same one-sided shape H16 fixed for module_include.
  const h = hits("class_base", "bare_class");

  assert.equal(h.length, 1);
  assert.equal(h[0].class, undefined, "it votes for no base and conforms to none");
  assert.equal(h[0].self, "TmpPlain");
});

test("a class that names any superclass at all is not an omission", needsRuby, () => {
  // Measured: `ActiveRecord::Migration[7.2]` is an index call, so it names no
  // constant. Counting a non-constant superclass as an omission took mastodon's
  // db/migrate from 41 of 41 to 41 of 576 and lost the claim in two directories
  // that hold nothing but migrations.
  assert.deepEqual(hits("class_base", "struct_super"), []);
  assert.deepEqual(hits("class_base", "migration_indexed_super"), []);
});

test("a nested class, a reopening and a namespacing module are not omissions", needsRuby, () => {
  // Each has somewhere else to have got its base: a nested class is the outer
  // class's helper, a reopening declares its superclass in the part that
  // carries it, and a module is not a class at all.
  const h = hits("class_base", "nested_and_reopened");

  assert.deepEqual(h.map((x) => [x.where, x.class ?? null]), [["Outer", "ApplicationRecord"]]);
});

/* --- the Ruby wrapper is not one of its own sites either (#68) --- */

test("the repository's own client is not an http_through_client site", needsRuby, () => {
  // Its own client is the one file that has to reach Net::HTTP directly. The
  // map named it as an exception to routing through itself.
  const file = programs.get("http_mixed");
  assert.ok(file && file.ok, "the fixture parsed");
  const at = (rel) => {
    const out = [];
    dim("http_through_client").run(file.program, (h) => out.push(h), { rel });
    return out;
  };

  assert.deepEqual(at("app/clients/client.rb"), []);
  assert.deepEqual(at("app/services/assembly/request.rb"), []);
  assert.ok(at("app/services/payment_service.rb").length > 0, "an ordinary service still counts");
  assert.ok(at("app/models/payment_api.rb").length > 0, "and so does a file that merely mentions the vocabulary");
});

test("a Sidekiq perform is not a service entry point, because returning is how a job says it succeeded", needsRuby, () => {
  // A job that returns instead of raising is acked as successful: never
  // retried, never in the dead set, never in Sentry. The claim's remedy is the
  // one thing a worker must not do.
  const file = programs.get("sidekiq_worker");
  assert.ok(file && file.ok, "the fixture parsed");
  const out = [];
  dim("service_result_shape").run(file.program, (h) => out.push(h));

  assert.deepEqual(out, []);
});

test("an ordinary call entry point in the same shape is still a site", needsRuby, () => {
  const file = programs.get("service_raises");
  assert.ok(file && file.ok, "the fixture parsed");
  const out = [];
  dim("service_result_shape").run(file.program, (h) => out.push(h));

  assert.equal(out.length, 1);
});

test("isRubyError names the language's own exception classes and nothing else", needsRuby, async () => {
  const { isRubyError } = await import("../plugins/anatomiya/lib/dimensions-ruby.mjs");

  for (const b of ["StandardError", "Exception", "ArgumentError", "SystemCallError", "Errno::ENOENT", "Errno::EACCES", "Encoding::CompatibilityError"]) {
    assert.equal(isRubyError(b), true, b);
  }
  for (const b of ["AppError", "QuotaExceededError", "ActiveRecord::RecordNotFound", "ActiveInteraction::Base", "ApplicationRecord", "MyErrno::Thing"]) {
    assert.equal(isRubyError(b), false, b);
  }
});

test("the Ruby bridge hands a row the path it read, not just the tree", needsRuby, async () => {
  // The JavaScript bridge and this one both have the path and only one passed
  // it, so the capability rows saw it on one engine and not the other: the
  // repository's own client would have been excused in TypeScript and charged
  // in Ruby.
  const wrapper = write("zz_client", "class Client\n  def go\n    Net::HTTP.get(uri)\n  end\nend\n");
  const service = write("zz_payment_service", "class PaymentService\n  def go\n    Net::HTTP.get(uri)\n  end\nend\n");
  const { RUBY_DIMENSIONS } = await import("../plugins/anatomiya/lib/dimensions-ruby.mjs");
  const { results } = await parseRuby(
    [
      { rel: "app/clients/client.rb", abs: wrapper.abs, lang: "ruby" },
      { rel: "app/services/payment_service.rb", abs: service.abs, lang: "ruby" },
    ],
    { dimensions: RUBY_DIMENSIONS.filter((d) => d.key === "http_through_client") }
  );
  const at = (rel) => results.find((r) => r.rel === rel);

  assert.equal(at("app/clients/client.rb").hits.http_through_client, undefined, "the client implements the routing");
  assert.equal(at("app/services/payment_service.rb").hits.http_through_client.length, 1);
});

test("a learned-class hit carries the scope its bare names resolve in", needsRuby, () => {
  // `Module.nesting` for an `include` inside `class Widget` is the class body
  // itself, then each module above it. Read off a helper that appended the
  // class to a stack it was already on, the scope came back with the class
  // name twice and no bare mixin could ever resolve.
  const [include] = hits("module_include", "nested_include");
  assert.deepEqual(include.nesting, ["Api::V1::Widget", "Api::V1", "Api"]);

  // The compact spellings read the same way, or a repository writing
  // `module Api::V1` loses the prefix and no bare mixin resolves.
  // A compact path opens one scope, not one per segment: `class A3::B3::E`
  // nests as itself alone, and a bare name it does not hold is a top-level one.
  const compact = hits("module_include", "compact_bodies").map((h) => h.nesting);
  assert.deepEqual(compact, [["A2::B2::D", "A2::B2"], ["A3::B3::E"]]);

  // A superclass is evaluated where the declaration is written, so the compact
  // form is written at the top level and its scope is empty.
  const [base] = hits("class_base", "compact_superclass").filter((h) => h.class);
  assert.equal(base.self, "Api::V1::QboController");
  assert.deepEqual(base.nesting, [], "the compact form resolves its superclass at the top level");
});
