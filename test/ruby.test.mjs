import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths, needsShebang } from "./platform.mjs";
import { needsRuby, needsRubyInterpreter } from "./ruby-available.mjs";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { choosePrism, listPrism, parseRuby, prismLoadArgs, RUBY_GUARDS, shardsBySize } from "../plugins/anatomiya/lib/ruby.mjs";
import { walkRuby, constName, bodyOf, site, args } from "../plugins/anatomiya/lib/ruby-walk.mjs";
import { RUBY_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-ruby.mjs";
import { collectHits } from "../plugins/anatomiya/lib/walk.mjs";
import { siteIdentity } from "../plugins/anatomiya/lib/introduced.mjs";
import { readiness } from "../plugins/anatomiya/lib/readiness.mjs";

const dir = mkdtempSync(join(tmpdir(), "anatomiya-ruby-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

/* --- which prism the parser loads --- */

// Ruby 3.3 ships prism 0.19 as its default gem, and 0.x spells the fields the
// dimensions read differently. `gem install prism` puts a 1.x beside it on any
// Ruby from 2.7, but the parser runs with gems disabled and saw only the
// default, so the one remedy that fits in a command could not work.
const spec = (version, { isDefault = false, paths = [`/gems/prism-${version}/lib`, `/ext/prism-${version}`] } = {}) =>
  ({ version, default: isDefault, paths });

test("a default prism at or past the floor is loaded as it always was, with nothing added", () => {
  assert.deepEqual(choosePrism([spec("1.2.0", { isDefault: true }), spec("1.9.0")], "1.0.0"), null);
});

test("a default prism under the floor gives way to the newest installed one past it", () => {
  const picked = choosePrism([spec("0.19.0", { isDefault: true }), spec("1.2.0"), spec("1.10.0"), spec("1.9.0")], "1.0.0");
  assert.equal(picked.version, "1.10.0", "by its numbers: 1.10 is newer than 1.9");
  assert.deepEqual(picked.paths, ["/gems/prism-1.10.0/lib", "/ext/prism-1.10.0"]);
});

test("nothing past the floor is nothing to add, and the default answers for itself", () => {
  assert.equal(choosePrism([spec("0.19.0", { isDefault: true }), spec("0.30.0")], "1.0.0"), null);
  assert.equal(choosePrism([], "1.0.0"), null);
});

test("a listing that is not the shape asked for adds nothing rather than a path it made up", () => {
  for (const bad of [
    null,
    "1.9.0",
    [{ version: "1.9.0", default: false, paths: ["relative/lib"] }],
    [{ version: "1.9.0", default: false, paths: ["-e"] }],
    [{ version: "1.9.0", default: false, paths: [] }],
    [{ version: "1.9.0", default: false }],
    [{ version: 1.9, default: false, paths: ["/gems/lib"] }],
  ]) {
    assert.equal(choosePrism(bad, "1.0.0"), null, JSON.stringify(bad));
  }
});

test("the listing names a prism installed in a gem path, by version and absolute load path", needsRubyInterpreter, async (t) => {
  // Asked of RubyGems rather than of prism, so it answers on any interpreter,
  // including one whose own prism is the 0.x this cannot read.
  const gems = mkdtempSync(join(tmpdir(), "anatomiya-gems-"));
  t.after(() => rmSync(gems, { recursive: true, force: true }));
  mkdirSync(join(gems, "specifications"), { recursive: true });
  mkdirSync(join(gems, "gems", "prism-1.99.0", "lib"), { recursive: true });
  writeFileSync(join(gems, "gems", "prism-1.99.0", "lib", "prism.rb"), "module Prism; VERSION = \"1.99.0\"; end\n");
  writeFileSync(
    join(gems, "specifications", "prism-1.99.0.gemspec"),
    'Gem::Specification.new do |s|\n  s.name = "prism"\n  s.version = "1.99.0"\n  s.summary = "planted"\n  s.authors = ["t"]\n  s.files = ["lib/prism.rb"]\n  s.require_paths = ["lib"]\nend\n'
  );

  const specs = await listPrism({ env: { ...process.env, GEM_PATH: gems } });

  const planted = specs.find((s) => s.version === "1.99.0");
  assert.ok(planted, JSON.stringify(specs));
  assert.equal(planted.default, false);
  // RubyGems names the path in its own spelling: resolved through macOS's
  // /var -> /private/var link, and with forward slashes and an 8.3 short name
  // on Windows. Both sides are resolved so only the directory is compared.
  assert.equal(planted.paths.length, 1, JSON.stringify(planted.paths));
  assert.equal(realpathSync.native(planted.paths[0]), realpathSync.native(join(gems, "gems", "prism-1.99.0", "lib")));
});

test("the listing finds a --user-install under XDG_DATA_HOME", needsRubyInterpreter, async (t) => {
  // RubyGems puts a user install under $XDG_DATA_HOME/gem when ~/.gem does not
  // exist, and a listing that dropped the variable looked under
  // ~/.local/share instead: `gem install --user-install prism` was installed
  // and invisible, and doctor went on naming the remedy just run.
  const home = mkdtempSync(join(tmpdir(), "anatomiya-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const api = execFileSync("ruby", ["-e", 'print RbConfig::CONFIG["ruby_version"]'], { encoding: "utf8" });
  const gems = join(home, "xdg", "gem", "ruby", api);
  mkdirSync(join(gems, "specifications"), { recursive: true });
  mkdirSync(join(gems, "gems", "prism-1.98.0", "lib"), { recursive: true });
  writeFileSync(
    join(gems, "specifications", "prism-1.98.0.gemspec"),
    'Gem::Specification.new do |s|\n  s.name = "prism"\n  s.version = "1.98.0"\n  s.summary = "planted"\n  s.authors = ["t"]\n  s.files = []\n  s.require_paths = ["lib"]\nend\n'
  );
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "xdg") };
  delete env.GEM_HOME;
  delete env.GEM_PATH;

  const specs = await listPrism({ env });

  assert.ok(Array.isArray(specs), "the listing answered");
  assert.ok(specs.some((s) => s.version === "1.98.0"), JSON.stringify(specs));
});

test("the listing loads no installed gem's library, so a newer json cannot silence it", needsRubyInterpreter, async (t) => {
  // With RubyGems enabled, `require "json"` activated the newest installed
  // json gem; one that raised (or merely printed) cost every prism choice.
  const gems = mkdtempSync(join(tmpdir(), "anatomiya-gems-json-"));
  t.after(() => rmSync(gems, { recursive: true, force: true }));
  mkdirSync(join(gems, "specifications"), { recursive: true });
  mkdirSync(join(gems, "gems", "json-99.0.0", "lib"), { recursive: true });
  writeFileSync(join(gems, "gems", "json-99.0.0", "lib", "json.rb"), 'print "GEM CODE RAN"\nraise "planted json"\n');
  writeFileSync(
    join(gems, "specifications", "json-99.0.0.gemspec"),
    'Gem::Specification.new do |s|\n  s.name = "json"\n  s.version = "99.0.0"\n  s.summary = "planted"\n  s.authors = ["t"]\n  s.files = ["lib/json.rb"]\n  s.require_paths = ["lib"]\nend\n'
  );

  const specs = await listPrism({ env: { ...process.env, GEM_PATH: gems, GEM_HOME: gems } });

  assert.ok(Array.isArray(specs), "the listing still answers");
});

test("a listed prism that raises on load is never put on the load path", needsRubyInterpreter, async (t) => {
  // The listing is RubyGems' record, and a record says nothing about whether
  // the extension it names was built for this interpreter. A gem that raises
  // the way an extension linked to another libruby does is newest here, so
  // the choice has to be proved to load before the parser is handed it.
  const gems = mkdtempSync(join(tmpdir(), "anatomiya-gems-broken-"));
  t.after(() => rmSync(gems, { recursive: true, force: true }));
  mkdirSync(join(gems, "specifications"), { recursive: true });
  mkdirSync(join(gems, "gems", "prism-1.99.0", "lib"), { recursive: true });
  writeFileSync(join(gems, "gems", "prism-1.99.0", "lib", "prism.rb"), 'raise LoadError, "incompatible library version"\n');
  writeFileSync(
    join(gems, "specifications", "prism-1.99.0.gemspec"),
    'Gem::Specification.new do |s|\n  s.name = "prism"\n  s.version = "1.99.0"\n  s.summary = "planted"\n  s.authors = ["t"]\n  s.files = ["lib/prism.rb"]\n  s.require_paths = ["lib"]\nend\n'
  );
  const env = { ...process.env, GEM_PATH: gems };
  assert.ok((await listPrism({ env })).some((s) => s.version === "1.99.0"), "the broken one is listed");

  const load = await prismLoadArgs({ env });

  assert.ok(!load.some((p) => p.startsWith(gems)), `the broken prism was chosen: ${load.join(" ")}`);
});

test("the parser loads the prism the listing chose, and says which", needsShebang, async (t) => {
  // A stub interpreter answers the ready line only for the load path the
  // listing handed it, so the version the run reports is the proof of which
  // prism parsed, off the same resolution the readiness probe uses. It also
  // answers the version question on that path, which is how the choice is
  // proved to load before the parser is handed it.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-ruby-stub-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(
    join(bin, "ruby"),
    `#!/bin/sh
case "$*" in
  *Gem::Specification*) printf '[{"version":"0.19.0","default":true,"paths":["/old/lib"]},{"version":"1.9.0","default":false,"paths":["/new/lib","/new/ext"]}]' ;;
  *"--disable-gems -I /new/lib -I /new/ext -rprism"*) printf 1.9.0 ;;
  *"--disable-gems -I /new/lib -I /new/ext -e"*) cat >/dev/null; printf '{"ready":true,"prism":"1.9.0"}\\n' ;;
  *) cat >/dev/null; printf '{"ready":true,"prism":"0.19.0"}\\n{"fatal":"prism 0.19.0 predates the field names this reads"}\\n'; exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
  const file = join(bin, "a.rb");
  writeFileSync(file, "class A\nend\n");

  const out = await parseRuby([{ rel: "a.rb", abs: file }], { ruby: join(bin, "ruby") });

  assert.equal(out.version, "1.9.0");
});

test("a version file in the repository chooses no interpreter: the listing, the probe and the parser all start outside it", needsShebang, async (t) => {
  // A version manager's shim picks its Ruby from the directory it starts in,
  // and a version file is the repository's to write: asdf reads a `path:`
  // version in `.tool-versions` as a directory to run the interpreter out of,
  // so resolving there would let the repository name a binary inside itself.
  // Every Ruby child starts in the temp directory instead, which is also what
  // keeps the three of them on one interpreter. The stub logs where it started,
  // spelled into its own body because the environment it gets is only PATH.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-ruby-where-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = join(bin, "started-in");
  writeFileSync(join(bin, "ruby"), `#!/bin/sh\npwd >> '${log}'\ncat >/dev/null\nexit 1\n`, { mode: 0o755 });
  const repo = mkdtempSync(join(tmpdir(), "anatomiya-ruby-pinned-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(join(repo, ".ruby-version"), "3.4.9\n");
  writeFileSync(join(repo, ".tool-versions"), "ruby path:./vendor/ruby\n");
  writeFileSync(join(repo, "a.rb"), "class A\nend\n");
  const path = process.env.PATH;
  const cwd = process.cwd();
  t.after(() => {
    process.env.PATH = path;
    process.chdir(cwd);
  });
  // The session sits in the repository, which is where a hook or a command
  // runs from, so a child that inherited the working directory would start there.
  process.chdir(repo);
  process.env.PATH = bin;

  await readiness({ engines: ["prism"], env: { PATH: bin } });
  await parseRuby([{ rel: "a.rb", abs: join(repo, "a.rb") }], { ruby: join(bin, "ruby") });

  const starts = readFileSync(log, "utf8").trim().split("\n");
  // The listing and the version question for the probe, then, since the stub
  // fails that, the bare run that tells a broken interpreter from a missing
  // library; the listing and the stream for the parser.
  assert.equal(starts.length, 5, starts.join("\n"));
  for (const at of starts) assert.equal(at, realpathSync(tmpdir()), `a Ruby child started in ${at}`);
});

test("a ruby planted in the temp directory never answers for an empty PATH entry", needsShebang, async (t) => {
  // Measured with the common trailing-colon PATH on a machine with no ruby:
  // the listing, the probe and the parser each ran a `ruby` another local
  // user had left in /tmp, as the person scanning. An empty or relative PATH
  // entry is resolved against the child's working directory, and every Ruby
  // child starts in the temp directory, which anyone can write. The stub
  // stands in for the planted one and logs that it ran.
  const shared = mkdtempSync(join(tmpdir(), "anatomiya-ruby-shared-"));
  t.after(() => rmSync(shared, { recursive: true, force: true }));
  const log = join(shared, "planted-ran");
  writeFileSync(join(shared, "ruby"), `#!/bin/sh\necho "$*" >> '${log}'\ncat >/dev/null\nexit 1\n`, { mode: 0o755 });
  const empty = mkdtempSync(join(tmpdir(), "anatomiya-ruby-nobin-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const file = join(empty, "a.rb");
  writeFileSync(file, "class A\nend\n");
  const saved = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  process.env.TMPDIR = shared;
  process.env.PATH = `${empty}:`;

  const [row] = await readiness({ engines: ["prism"], env: { PATH: `${empty}:` } });
  const out = await parseRuby([{ rel: "a.rb", abs: file }]);

  let ran = "";
  try {
    ran = readFileSync(log, "utf8");
  } catch {}
  assert.equal(ran, "", `the planted ruby ran:\n${ran}`);
  assert.equal(row.reason, "ruby is not on PATH");
  assert.ok(out.missingParser, "and the parser says no interpreter answered");
});

test("a prism too old to read is a missing parser, never a repository of crashed files", needsShebang, async (t) => {
  // The child refuses a 0.x prism with a fatal line before reading any file.
  // Charged per file, that read as "every Ruby file crashed the parser" with
  // exit 0 and no remedy, and withheld the whole map; the scan and the check
  // name the remedy only for a missing parser.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-ruby-old-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(
    join(bin, "ruby"),
    `#!/bin/sh
case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac
cat >/dev/null
printf '{"ready":true,"prism":"0.19.0"}\\n{"fatal":"prism 0.19.0 predates the field names this reads"}\\n'
exit 1
`,
    { mode: 0o755 }
  );
  const file = join(bin, "a.rb");
  writeFileSync(file, "class A\nend\n");

  const out = await parseRuby([{ rel: "a.rb", abs: file }], { ruby: join(bin, "ruby") });

  assert.match(String(out.missingParser), /prism 0\.19\.0 predates/);
});

test("a ruby our clock stopped before its ready line is a stall, not a missing install", needsShebang, async (t) => {
  // No version came back, which alone reads as an install to fix. The idle
  // window killed it both times, so what failed was the machine's time.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-ruby-stall-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(
    join(bin, "ruby"),
    `#!/bin/sh
case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac
cat >/dev/null
exec sleep 30
`,
    { mode: 0o755 }
  );
  const file = join(bin, "a.rb");
  writeFileSync(file, "class A\nend\n");

  const out = await parseRuby([{ rel: "a.rb", abs: file }], { ruby: join(bin, "ruby"), guards: { idleMs: 200 } });

  assert.equal(out.version, null);
  assert.equal(out.stalled, "ruby went silent");
  assert.equal(out.missingParser, null);
  assert.equal(out.results[0].crashed, true);
});

test("one stalled child beside one that answered is files charged, not a stall", needsShebang, async (t) => {
  // A single child that said ready and then went silent reports a version and
  // no stall. Split across children, the run has to answer the same way.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-ruby-half-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(
    join(bin, "ruby"),
    `#!/bin/sh
case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac
if tr '\\000' '\\n' | grep -q 'b[.]rb'; then exec sleep 30; fi
printf '{"ready":true,"prism":"9.9.9"}\\n{"rel":"a.rb","ok":false,"error":"x"}\\n'
`,
    { mode: 0o755 }
  );
  const files = ["a.rb", "b.rb"].map((rel) => ({ rel, abs: join(bin, rel) }));

  const out = await parseRuby(files, { ruby: join(bin, "ruby"), shards: 2, guards: { idleMs: 1500 } });

  assert.equal(out.version, "9.9.9");
  assert.equal(out.stalled, null);
  assert.deepEqual(out.results.map((r) => [r.rel, Boolean(r.crashed)]), [["a.rb", false], ["b.rb", true]]);
});

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
  rescue_ivar_binding: `
    begin
      a
    rescue => @error
      report(@error)
    end
    begin
      b
    rescue => @error
      nil
    end
  `,
  rescue_fail: `
    begin
      a
    rescue ActiveRecord::RecordNotFound
      fail Wrapped
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
  model_commit_callbacks: `
    class Welcome < ApplicationRecord
      after_create_commit :send_welcome
    end
    class Mirror < ApplicationRecord
      after_update_commit :sync
    end
    class Archive < ApplicationRecord
      after_destroy_commit :purge
    end
    class Index < ApplicationRecord
      after_save_commit :reindex
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
  service_fails: `
    class CreateOrder
      def call(params)
        fail ArgumentError, "missing" unless params[:id]
        Result.success
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
  service_bang: `
    class CompleteTask < ActiveInteraction::Base
      def execute
        task.update!(status: "completed")
      end
    end
    class Nested
      def call
        Other.run!(id: 1)
      end
    end
    class Create
      def self.call(attrs)
        User.create!(attrs)
      end
    end
  `,
  service_bang_rescued: `
    class Save
      def call
        user.save!
      rescue ActiveRecord::RecordInvalid => e
        errors.add(:base, e.message)
      end
    end
    class Quiet
      def call
        user.update!(a: 1) rescue nil
      end
    end
    class Merge
      def execute
        errors.merge!(other.errors)
        name.strip!
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
  log_setters: `
    Rails.application.configure do
      config.logger.level = Logger::ERROR
      config.logger.formatter = ::Logger::Formatter.new
    end
    Rails.logger.progname = "svc"
    logger.debug? && compute
  `,
  log_outputs: `
    def work
      logger.error("x")
      logger.fatal("x")
      logger.unknown("x")
      logger.add(1, "x")
      logger.log(1, "x")
      logger.tagged("a") { compute }
      logger << "x"
    end
  `,
  http_helpers: `
    class Scrape
      def go(msg)
        raise HTTParty::Error.new(msg)
        HTTParty::CookieHash.new
        Faraday::TimeoutError.new("x")
        Excon::Errors::SocketError.new
        Faraday::ConnectionFailed.new("x")
        RestClient::Exceptions::Timeout.new
        Excon::Error::Timeout.new
        Net::HTTP::Get.new(uri)
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

  http_gems: `
    class Feed
      def load(url)
        RestClient.get(url, accept: :json)
        RestClient::Request.execute(method: :get, url: url)
        HTTPClient.new.get(url)
        HTTParty.get(url)
        Faraday.get(url)
        HTTP.get(url)
        GithubClient.get(url)
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
  http_store: `
    class Registration
      def run(id)
        OauthClientStore.fetch(id)
        RequestStore.delete(:user)
        client_options.fetch(:timeout)
        request_params.delete(:id)
        api_method_cache.fetch(id)
        RefreshApiUserSecret.call(id)
        tunes_request_client.get("/x")
        http_client.post("/y")
        GithubApi.get("/z")
        fetcher.fetch(id)
        redis_client.get(id)
        cache_client.fetch(id)
        Redis::Client.get(id)
        HttpClientV2.get("/v")
        api_client_v1.post("/v")
        ApiV2.get("/v")
        db_client.execute(sql)
        PG::Client.execute(sql)
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
  time_unzoned_built: `
    def go
      Time.local(2026, 8, 20)
      Time.parse("2026-08-20")
      Time.at(1_786_000_000)
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
  infinite_float: `
INF = 1e400
`,
  binary_string: `# encoding: ascii-8bit
MAGIC = "\\xff"
`,
  index_assign_keyword: `
a[0, k: 1] = 2
`,
  same_short_name: `
class A::Worker
end

class B::Worker
  include Concern
end
`,
  singleton_include: `
class Settings
  class << self
    include Enumerable
  end
end
`,
  sidekiq_singleton_include: `
class NotAWorker
  class << self
    include Sidekiq::Worker
  end

  def perform(a, b, c)
  end
end
`,
  rescue_global_error: `
begin
  a
rescue
  log($!)
end

begin
  b
rescue
  log($ERROR_INFO)
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
  assert.ok(parsed.results.every((r) => !r.crashed));
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
  // The results are the record: `parse.mjs` classifies every outcome off them,
  // and the three counters this once carried beside them had no reader.
  assert.deepEqual(Object.keys(out).sort(), ["error", "missingParser", "results", "stalled", "truncated", "version"]);
  assert.equal(out.version, null, "nothing was started, so nothing reported a version");
  assert.equal(out.error, null);
});

test("a newline in a path is a path, not two paths", { ...needsPosixPaths, ...needsRuby }, async () => {
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
});

test("a file prism parses cleanly is read however long its chain of branches", needsRuby, async () => {
  // Measured: a 98-branch elsif chain, a 98-call method chain and a 98-term
  // `+` expression each came back `JSON::NestingError` and were reported as
  // files that could not be parsed, though prism found no error in any. The
  // tree is one to three JSON levels per node, and the encoder's default cap
  // is 100: a detail of how the answer is carried, charged to the repository.
  const branches = Array.from({ length: 99 }, (_, i) => `  elsif x == ${i + 1}\n    :a${i + 1}\n`).join("");
  const elsif = write("elsif_chain", `def kind(x)\n  if x == 0\n    :a0\n${branches}  end\nend\n`);
  const chain = write("method_chain", `def q\n  Model${Array.from({ length: 98 }, (_, i) => `.m${i}`).join("")}\nend\n`);

  const out = await parseRuby([elsif, chain]);

  for (const r of out.results) assert.equal(r.ok, true, `${r.rel}: ${r.error}`);
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

test("a path that reads like an option is parsed as a path", needsRuby, async () => {
  // Paths travel on stdin, never in argv, so a leading dash is only a name.
  // Skipping it was charged as a file over the size cap, and as an answer
  // from an interpreter that never ran.
  const abs = join(dir, "-rsocket.rb");
  writeFileSync(abs, "def go\n  1\nend\n");
  const out = await parseRuby([{ rel: "-rsocket.rb", abs }]);
  assert.equal(out.results[0].ok, true, out.results[0].error);
  assert.equal(out.results[0].skipped, undefined);
  assert.ok(out.version, "the interpreter read it");
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
  assert.equal(out.results[0].crashed, true, "the file is charged, not silently dropped");
});

test("a Ruby with no prism at all is a missing parser, not a file that crashed it", needsRubyInterpreter, async (t) => {
  // Ruby 2.7 to 3.2 before `gem install prism`: the script's own require
  // raised before it could say why, so every file read as crashing the parser,
  // check reported nothing found and scan wrote nothing, with no remedy.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-ruby-noprism-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, "prism.rb"), 'raise LoadError, "cannot load such file -- prism"\n');
  const stub = join(bin, "ruby");
  writeFileSync(
    stub,
    `#!/bin/sh\nfor a; do shift; case "$a" in -I*) ;; *) set -- "$@" "$a";; esac; done\nexec ruby -I '${bin}' "$@"\n`,
    { mode: 0o755 }
  );

  const out = await parseRuby([{ rel: "a.rb", abs: join(dir, "rescue_none.rb") }], { ruby: stub });

  assert.equal(out.results[0].missingParser, true, JSON.stringify(out.results[0]));
  assert.match(out.error, /prism/);
});

test("a literal JSON cannot spell is still a file that parsed", needsRuby, () => {
  // `1e400` is Infinity and a binary-encoded "\xff" is not UTF-8, and either one
  // raised JSON::GeneratorError in the encoder: a file prism read without a
  // single error was reported as unread. Neither value is anything a
  // dimension reads, so each is dropped from the tree rather than the file.
  for (const name of ["infinite_float", "binary_string"]) {
    const file = programs.get(name);
    assert.equal(file.ok, true, `${name}: ${file.error}`);
  }
});

test("the grammar is the interpreter's own, not prism's newest", needsRuby, () => {
  // Keywords in an index assignment are an error from Ruby 3.4 and valid
  // before it, and prism parses as the newest Ruby it knows unless told
  // otherwise: on Ruby 3.3 the file read as a syntax error Ruby itself accepts.
  const ruby = execFileSync("ruby", ["-e", "print RUBY_VERSION"], { encoding: "utf8" });
  const [major, minor] = ruby.split(".").map(Number);
  const file = programs.get("index_assign_keyword");
  assert.equal(file.ok, major < 3 || (major === 3 && minor < 4), JSON.stringify({ ruby, error: file.error }));
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
  assert.equal(out.results.filter((r) => r.ok).length, 40, "every file answered");
});

test("one enormous line still stops the run, because V8 refuses to hold the string", needsRuby, async () => {
  // The guard reads the undrained buffer, so it only sees a line that spans
  // stdout chunks. 2,000 statements is roughly 400 KB of JSON against a 64 KB
  // pipe chunk; a small fixture arrives whole and drains before the check.
  const big = write("huge", Array.from({ length: 2000 }, (_, i) => `X${i} = Time.zone.now`).join("\n") + "\n");
  const out = await parseRuby([big], { guards: { ...RUBY_GUARDS, maxLineBytes: 8 } });

  assert.equal(out.truncated, true, "the caller must suppress every directive on this");
  assert.equal(out.results.filter((r) => r.ok).length, 0, "nothing was counted from a run that stopped mid-line");
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

test("leaving a declaration hands its context back to the one around it", () => {
  const seen = {};
  const call = (name) => ({ t: "call", name });
  const tree = {
    t: "class",
    name: "Outer",
    body: [
      { t: "def", name: "run", body: [call("inDef"), { t: "class", name: "Local", body: [call("inLocal")] }, call("afterLocal")] },
      call("afterDef"),
      { t: "singleton_class", body: [call("inSingleton")] },
      { t: "module", name: "Inner", body: [call("inInner")] },
      call("afterInner"),
    ],
  };
  walkRuby(tree, (n, ctx) => {
    if (n.t === "call") seen[n.name] = [ctx.def?.name ?? null, ctx.cls?.name ?? null, ctx.enclosing?.t ?? null, ctx.stack.length];
  });
  assert.deepEqual(seen, {
    inDef: ["run", "Outer", "def", 2],
    inLocal: ["run", "Local", "class", 3],
    afterLocal: ["run", "Outer", "def", 2],
    afterDef: [null, "Outer", "class", 1],
    inSingleton: [null, "Outer", "singleton_class", 2],
    inInner: [null, "Inner", "module", 2],
    afterInner: [null, "Outer", "class", 1],
  });
});

test("a run split across children answers every file in the order it was handed", needsRuby, async () => {
  const files = Object.keys(SRC).map((name) => ({ rel: `${name}.rb`, abs: join(dir, `${name}.rb`) }));
  const one = await parseRuby(files, { dimensions: RUBY_DIMENSIONS, shards: 1 });
  const split = await parseRuby(files, { dimensions: RUBY_DIMENSIONS, shards: 3 });

  assert.deepEqual(split.results.map((r) => r.rel), files.map((f) => f.rel));
  assert.deepEqual(split.results, one.results, "the same records, whichever child read them");
  assert.equal(split.version, one.version);
  assert.equal(split.error, null);
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

test("a rescue bound to an instance variable uses the error by reading it", needsRuby, () => {
  // `rescue => @error` binds the caught error exactly as `rescue => e` does,
  // and only the local read was looked for, so the use read as a swallow.
  assert.deepEqual(counts("rescue_uses_error", "rescue_ivar_binding"), { candidates: 2, conforming: 1 });
});

test("a bare rescue that reads $! uses the error it caught", needsRuby, () => {
  // `rescue; log($!)` hands the caught error on as surely as `rescue => e;
  // log(e)`, and with nothing bound it read as a swallow. `$ERROR_INFO` is the
  // English library's name for the same variable.
  assert.deepEqual(counts("rescue_uses_error", "rescue_global_error"), { candidates: 2, conforming: 2 });
});

test("fail re-raises exactly as raise does", needsRuby, () => {
  // Kernel#fail is raise's alias, and the "fail to signal, raise to re-raise"
  // style spells half its raises with it.
  assert.deepEqual(counts("rescue_uses_error", "rescue_fail"), { candidates: 1, conforming: 1 });
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

test("the after_*_commit shorthands register lifecycle callbacks like any other", needsRuby, () => {
  // Measured: forty models each registering after_create_commit and
  // after_update_commit read as 40 of 40 keeping behaviour out of callbacks.
  // These four are how Rails 5 and 6 recommend spelling a commit callback, so
  // the row stated its claim in exactly the wrong direction on modern apps.
  assert.deepEqual(counts("model_callbacks", "model_commit_callbacks"), { candidates: 4, conforming: 0 });
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

test("an entry point that fails is raising, whichever alias it spells", needsRuby, () => {
  // Measured: `fail ArgumentError` in a call method counted as returning its
  // failure, which inflates the claim side of the row in exactly the
  // codebases that prefer fail for signalling.
  assert.deepEqual(counts("service_result_shape", "service_fails"), { candidates: 1, conforming: 0 });
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

test("an entry point that fails through a bang call raises, whatever it spells", needsRuby, () => {
  // `update!`, `create!` and `run!` raise on failure. Read as having no raise
  // keyword, 36 services failing through an unrescued update! stated the claim.
  assert.deepEqual(counts("service_result_shape", "service_bang"), { candidates: 3, conforming: 0 });
});

test("a bang call its own rescue catches does not raise, and a bang that is not a failure is not one", needsRuby, () => {
  assert.deepEqual(counts("service_result_shape", "service_bang_rescued"), { candidates: 3, conforming: 3 });
});

test("the claim says what the predicate measures, not that a failure is returned", () => {
  // An entry point with no failure path conforms, so a sentence promising a
  // returned failure was stated over code that returns none.
  const row = dim("service_result_shape");
  assert.doesNotMatch(row.claim, /return/);
  assert.match(row.claim, /bang/);
});

test("the row states no inverse, because an entry point with no failure path is not a raise it skipped", () => {
  // Stated over a directory of `update!` services, "raise on failure" gave a
  // FIX to a pure service that has no failure to raise.
  assert.equal(dim("service_result_shape").counterClaim, null);
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

test("the claim covers the times it builds, not only the clock it reads", () => {
  // Time.parse(value) and Time.zone.at(n) are sites and read no clock, so a
  // sentence about "the current time" was quoted against lines that do neither.
  assert.doesNotMatch(dim("zone_aware_time").claim, /current time/);
  assert.match(dim("zone_aware_time").claim, /built/);
});

test("a file that never reads the clock contributes nothing", needsRuby, () => {
  assert.equal(hits("zone_aware_time", "time_none").length, 0);
});

// --- the shape the reducer relies on ---

test("every Ruby row answers the same on the shared walk as walking alone, with a frozen ctx", needsRuby, () => {
  assert.deepEqual(RUBY_DIMENSIONS.filter((d) => !d.visitor).map((d) => d.key), []);
  // A visitor that writes to the ctx it shares with every other row throws
  // here, and loses its sites. The arrays are frozen copies, since the walk's
  // own are live and a frozen ctx alone still lets a visitor push onto them.
  const frozen = (tree, visit) =>
    walkRuby(tree, (node, ctx) =>
      visit(node, Object.freeze({ ...ctx, stack: Object.freeze([...ctx.stack]), ancestors: Object.freeze([...ctx.ancestors]) }))
    );
  const reached = new Set();
  for (const [name, file] of programs) {
    const extra = { rel: `${name}.rb` };
    const alone = collectHits(file.program, RUBY_DIMENSIONS.map((d) => ({ key: d.key, run: d.run })), extra);
    assert.deepEqual(collectHits(file.program, RUBY_DIMENSIONS, extra, { walker: frozen }), alone, name);
    for (const key of Object.keys(alone)) reached.add(key);
  }
  assert.equal(reached.size, RUBY_DIMENSIONS.length, "the fixtures should reach every row");
});

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
        // introduced.mjs destructures hit.node on every hit and reads type, name
        // and line off it. A ruby hit without one throws there, not here.
        assert.ok(h.node && typeof h.node === "object", `${at} emitted no node`);
        assert.equal(typeof h.node.type, "string", at);
        assert.ok(h.node.name === null || typeof h.node.name === "string", at);
        assert.ok(typeof h.node.line === "number" && h.node.line > 0, at);
        // B5: an offset here would be a UTF-8 byte count handed to a slice of a
        // UTF-16 string.
        assert.notEqual(typeof h.node.start, "number", at);
        assert.notEqual(typeof h.node.end, "number", at);
        // With no offsets the identity is the name, and the line plays no part.
        assert.equal(siteIdentity("app/w.rb", d.key, h.node, ""), siteIdentity("app/w.rb", d.key, { ...h.node, line: h.node.line + 100 }, ""), at);
        if (typeof h.node.name === "string") {
          assert.notEqual(siteIdentity("app/w.rb", d.key, h.node, ""), siteIdentity("app/w.rb", d.key, { ...h.node, name: `${h.node.name}X` }, ""), at);
        }
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
    // The question of which prism to load is asked before any parse child,
    // and is not one: it holds no default to replace, so nothing is added.
    `case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac`,
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
  assert.deepEqual(out.results.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(out.results.map((r) => r.attempts), [2, 2, 2]);
  assert.equal(readFileSync(join(home, "runs"), "utf8").trim(), "2", "one more child, not a loop");
});

test("the second child is handed only what the first never answered", needsShebang, async () => {
  const home = mkdtempSync(join(dir, "retry-partial-"));
  const stub = retryStub(home, [answer('"a.rb"'), "  sleep 30"]);

  const files = ["a.rb", "b.rb", "c.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: stub, guards: { idleMs: 1500 } });

  assert.deepEqual(out.results.map((r) => r.ok), [true, true, true]);
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

  assert.deepEqual(out.results.map((r) => r.ok), [true, true]);
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
      `case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac`,
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
  assert.deepEqual(out.results.map((r) => [r.crashed, r.attempts]), [[true, 2], [true, 2]]);
  assert.deepEqual(out.results.map((r) => r.error), ["ruby went silent", "ruby went silent"]);
});

test("a child that died by itself is charged, not tried again", needsShebang, async () => {
  // The other half of the ruling. An interpreter that exits on its own is a
  // broken install or a fatal from the script, and a second child answers it
  // the same way at twice the cost.
  const home = mkdtempSync(join(dir, "no-retry-"));
  const script = [
    "#!/bin/sh",
    `case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac`,
    `echo x >> '${home}/runs'`,
    "cat > /dev/null",
    "exit 1",
    "",
  ].join("\n");
  writeFileSync(join(home, "ruby"), script, { mode: 0o755 });

  const files = ["a.rb", "b.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
  const out = await parseRuby(files, { ruby: join(home, "ruby") });

  assert.equal(readFileSync(join(home, "runs"), "utf8"), "x\n", "one child, no second one");
  assert.deepEqual(out.results.map((r) => [r.ok, r.crashed]), [[false, true], [false, true]]);
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
  assert.equal(out.results[0].ok, true);
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
  assert.equal(out.results[0].ok, true);
});

// --- capability routing, Ruby side ---

test("puts and friends are direct sites and logger calls conform", needsRuby, () => {
  assert.deepEqual(counts("logger_over_puts", "log_mixed"), { candidates: 4, conforming: 2 });
});

test("an instance-variable logger conforms too", needsRuby, () => {
  assert.deepEqual(counts("logger_over_puts", "log_wrapped"), { candidates: 1, conforming: 1 });
});

test("setting up a logger is not output through it", needsRuby, () => {
  // `level=`, `formatter=` and `progname=` configure the logger and write
  // nothing, and read as sites they made a config directory an adopter.
  assert.deepEqual(hits("logger_over_puts", "log_setters"), []);
});

test("every output call a logger answers is a conforming site", needsRuby, () => {
  assert.deepEqual(counts("logger_over_puts", "log_outputs"), { candidates: 7, conforming: 7 });
});

test("an HTTP library's error or cookie class is not a request", needsRuby, () => {
  // Building an exception sends nothing. A request class under the library's
  // namespace still does.
  const h = hits("http_through_client", "http_helpers");
  assert.deepEqual(h.map((x) => [x.node.line, x.conforming]), [[11, false]]);
});

test("Net::HTTP and URI.open are direct sites and client calls conform", needsRuby, () => {
  assert.deepEqual(counts("http_through_client", "http_mixed"), { candidates: 4, conforming: 2 });
});

test("an ActiveRecord-shaped call on a client-named constant is not an HTTP site", needsRuby, () => {
  assert.deepEqual(counts("http_through_client", "http_model"), { candidates: 1, conforming: 1 });
});

test("a receiver whose name only mentions the client vocabulary is not a client", needsRuby, () => {
  // The last word is what the thing is: `OauthClientStore` is a store and
  // `request_params` is a hash, so a repository fetching from them fourteen
  // files over stated that HTTP goes through its own client with no HTTP in it.
  const h = hits("http_through_client", "http_store");
  assert.deepEqual(h.map((x) => [x.node.line, x.conforming]), [[10, true], [11, true], [12, true], [13, true], [17, true], [18, true], [19, true]]);
});

test("a raw Net::HTTP block handle named http is not a conforming client", needsRuby, () => {
  assert.deepEqual(counts("http_through_client", "http_raw_block"), { candidates: 1, conforming: 0 },
    "only the Net::HTTP.start site counts, and it counts against");
});

test("an HTTP library's own constant is a direct call, not the repository's client", needsRuby, () => {
  // Measured: forty files calling RestClient.get read as "HTTP goes through the
  // repository's own client, 80 of 81", in a repository with no client at all,
  // because RestClient and HTTPClient carry the vocabulary in their names. They
  // are what a wrapper wraps, the way axios is on the JS side.
  const h = hits("http_through_client", "http_gems");
  assert.deepEqual(h.map((x) => [x.node.line, x.conforming]), [
    [4, false], [5, false], [6, false], [7, false], [8, false], [9, false], [10, true],
  ]);
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

test("the Sidekiq mixin included into the singleton class does not make the class a worker", needsRuby, () => {
  // `class << self; include Sidekiq::Worker; end` mixes into the metaclass, so
  // the class's own `perform` is not what Sidekiq calls, and it was dropped as
  // a keyword_params site on the strength of an include that never reached it.
  assert.deepEqual(hits("keyword_params", "sidekiq_singleton_include").map((h) => h.where), ["perform"]);
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

test("a time built past the app zone is the violation its zoned twin conforms against", needsRuby, () => {
  // Measured: twenty files calling Time.zone.parse and Time.zone.at beside
  // twenty calling Time.parse and Time.at read as 40 of 40 through the
  // application zone, on a row declared precise. Counting only the conforming
  // half of a pair makes the claim unfalsifiable in the one place it bites.
  assert.deepEqual(counts("zone_aware_time", "time_unzoned_built"), { candidates: 3, conforming: 0 });
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
  const versioned = write("zz_api_client_v2", "class ApiClientV2\n  def go\n    Net::HTTP.get(uri)\n  end\nend\n");
  const midVersion = write("zz_api_v2_client", "class ApiV2Client\n  def go\n    Net::HTTP.get(uri)\n  end\nend\n");
  const { RUBY_DIMENSIONS } = await import("../plugins/anatomiya/lib/dimensions-ruby.mjs");
  const { results } = await parseRuby(
    [
      { rel: "app/clients/client.rb", abs: wrapper.abs, lang: "ruby" },
      { rel: "app/services/payment_service.rb", abs: service.abs, lang: "ruby" },
      { rel: "app/clients/api_client_v2.rb", abs: versioned.abs, lang: "ruby" },
      { rel: "app/clients/api_v2_client.rb", abs: midVersion.abs, lang: "ruby" },
    ],
    { dimensions: RUBY_DIMENSIONS.filter((d) => d.key === "http_through_client") }
  );
  const at = (rel) => results.find((r) => r.rel === rel);

  assert.equal(at("app/clients/client.rb").hits.http_through_client, undefined, "the client implements the routing");
  assert.equal(at("app/clients/api_client_v2.rb").hits.http_through_client, undefined, "a version is not what the file is");
  assert.equal(at("app/clients/api_v2_client.rb").hits.http_through_client, undefined, "wherever the version sits");
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

test("two classes sharing a short name are two bodies, whichever holds the include", needsRuby, () => {
  // Named by the last segment, `class A::Worker` and `class B::Worker` were both
  // `Worker`, so B's include read as A's declaration elsewhere in the file and
  // A's forgotten include was never a site.
  const h = hits("module_include", "same_short_name");
  assert.equal(h.length, 2);
  assert.deepEqual(h.filter((x) => x.class).map((x) => x.class), ["Concern"]);
  assert.ok(h.some((x) => x.where === "A::Worker" && !x.class), "A::Worker includes nothing and is a site");
});

test("an include inside class << self is not an include into the class", needsRuby, () => {
  // It mixes into the metaclass, which is `extend` by another spelling: the
  // class declared a mixin, but not one its instances carry, so it is neither
  // a vote for the module nor a class that forgot one.
  assert.deepEqual(hits("module_include", "singleton_include"), []);
});

test("the Ruby site and argument readers live in the leaf both registries import", () => {
  // Both registries carried a byte-identical `site`, and only one carried the
  // reason its offsets are null (B5); the argument read was spelled four ways.
  assert.deepEqual(site({ t: "call", name: "include", line: 4 }), { type: "call", name: "include", line: 4, start: null, end: null });
  assert.deepEqual(site({ t: "class", name: 7, line: "x" }), { type: "class", name: null, line: null, start: null, end: null });
  assert.deepEqual(args(null), []);
  assert.deepEqual(args({ t: "call" }), []);
  assert.deepEqual(args({ t: "call", arguments: { arguments: [1, 2] } }), [1, 2]);
  for (const file of ["dimensions-ruby.mjs", "dimensions-rails.mjs"]) {
    const source = readFileSync(new URL(`../plugins/anatomiya/lib/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /const site =|arguments\.arguments|arguments\?\.arguments/, `${file} reads both off the leaf`);
  }
});

// --- shards: balanced by bytes, read off the parent thread ---

test("shards are balanced by bytes, the largest file first into the lightest shard", () => {
  // Contiguous batches put the heavy end of a Rails tree in one child: on
  // empire-flippers/api the last of four took 3.1s against 1.2s for the first.
  assert.deepEqual(shardsBySize([9, 1, 1, 1, 1, 1, 1, 1, 1], 2), [[0], [1, 2, 3, 4, 5, 6, 7, 8]]);
  // Equal sizes keep input order, and an equal load goes to the shard holding fewer files.
  assert.deepEqual(shardsBySize([3, 3, 3, 3], 2), [[0, 2], [1, 3]]);
  assert.deepEqual(shardsBySize([0, 0], 2), [[0], [1]]);
  // Each shard lists its files in input order, and the shards follow their first file.
  assert.deepEqual(shardsBySize([1, 9], 2), [[0], [1]]);
  assert.deepEqual(shardsBySize([1, 9, 5], 2), [[0, 2], [1]]);
  assert.deepEqual(shardsBySize([5], 3), [[0]]);
});

/** Run `parse`, recording every stream line this thread hands `JSON.parse`. */
async function linesParsedHere(parse) {
  const lines = [];
  const original = JSON.parse;
  JSON.parse = function (text, ...rest) {
    if (typeof text === "string" && /^\{"(ready|fatal|rel)"/.test(text)) lines.push(text.slice(0, 60));
    return original.call(this, text, ...rest);
  };
  try {
    return { out: await parse(), lines };
  } finally {
    JSON.parse = original;
  }
}

test("the parent reads no line of the stream: trees are parsed and walked off its thread", needsRuby, async () => {
  // The trees for empire-flippers/api are 75 MB of JSON, and reading and
  // walking them here was 2.28s of a 3.45s parse phase on one core.
  const files = Object.keys(SRC).map((name) => ({ rel: `${name}.rb`, abs: join(dir, `${name}.rb`) }));
  const { out, lines } = await linesParsedHere(() => parseRuby(files, { dimensions: RUBY_DIMENSIONS, shards: 2 }));

  assert.ok(out.results.some((r) => r.ok && r.hits && Object.keys(r.hits).length), "the run answered counts");
  assert.ok(out.results.every((r) => r.program === null || r.program === undefined), "and no tree");
  assert.deepEqual(lines, []);
});

/** A stub interpreter, warmed once so a short idle window times the script and not the first exec. */
function stubRuby(name, body) {
  const home = mkdtempSync(join(dir, `${name}-`));
  const path = join(home, "ruby");
  writeFileSync(
    path,
    ["#!/bin/sh", `if [ "$1" = "--warm" ]; then exit 0; fi`, `case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac`, ...body, ""].join("\n"),
    { mode: 0o755 }
  );
  execFileSync(path, ["--warm"]);
  return path;
}

const READY = `printf '{"ready":true,"prism":"1.0.0"}\\n'`;
const pair = ["a.rb", "b.rb"].map((rel) => ({ rel, abs: join(dir, "rescue_none.rb") }));
const shape = (out) => ({
  version: out.version,
  error: out.error,
  missingParser: out.missingParser,
  stalled: out.stalled,
  truncated: out.truncated,
  results: out.results.map((r) => [r.rel, r.ok, r.error ?? null, Boolean(r.crashed), r.attempts]),
});

/** A stub that answers every file it is handed and keeps each child's list as `in.<pid>`. */
function recordingStub(name) {
  return stubRuby(name, [
    `in="$(dirname "$0")/in.$$"`,
    `tr '\\0' '\\n' > "$in"`,
    READY,
    "while IFS= read -r rel && IFS= read -r abs; do",
    `  printf '{"rel":"%s","ok":true,"errors":0,"length":1,"ast":{"t":"program","line":1}}\\n' "$rel"`,
    `done < "$in"`,
  ]);
}

/** What each child was handed, as lists of relative paths, sorted for comparison. */
function handed(ruby) {
  const home = join(ruby, "..");
  return readdirSync(home)
    .filter((f) => f.startsWith("in."))
    .map((f) => readFileSync(join(home, f), "utf8").split("\n").slice(0, -1).filter((_, i) => i % 2 === 0))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

test("a file over the size cap weighs nothing in the balance, as the child reads none of it", needsShebang, async () => {
  // The child skips it unread, so weighed at its size it took a shard to itself
  // and left the others to split everything else.
  const files = [write("cap_big", "x".repeat(1000)), write("cap_a", "a".repeat(100)), write("cap_b", "b".repeat(100)), write("cap_c", "c".repeat(100))];
  const ruby = recordingStub("cap-balance");
  const out = await parseRuby(files, { ruby, shards: 2, guards: { maxBytes: 500 } });
  assert.equal(out.results.length, 4);
  assert.deepEqual(handed(ruby), [["cap_a.rb", "cap_c.rb"], ["cap_big.rb", "cap_b.rb"]]);
});

test("failure class, no interpreter: every file charged as a missing parser, off the parent", async () => {
  const { out, lines } = await linesParsedHere(() =>
    parseRuby(pair, { ruby: "anatomiya-no-such-ruby", dimensions: RUBY_DIMENSIONS })
  );
  const why = "spawn anatomiya-no-such-ruby ENOENT";
  assert.deepEqual(shape(out), {
    version: null, error: why, missingParser: why, stalled: null, truncated: false,
    results: [["a.rb", false, why, true, 1], ["b.rb", false, why, true, 1]],
  });
  assert.ok(out.results.every((r) => r.missingParser === true));
  assert.deepEqual(lines, []);
});

test("failure class, an interpreter exiting non-zero: its own stderr is the reason", needsShebang, async () => {
  const ruby = stubRuby("exit3", ["cat >/dev/null", "echo 'boom: no libruby' >&2", "exit 3"]);
  const { out, lines } = await linesParsedHere(() => parseRuby(pair, { ruby, dimensions: RUBY_DIMENSIONS }));
  assert.deepEqual(shape(out), {
    version: null, error: "boom: no libruby", missingParser: null, stalled: null, truncated: false,
    results: [["a.rb", false, "boom: no libruby", true, 1], ["b.rb", false, "boom: no libruby", true, 1]],
  });
  assert.deepEqual(lines, []);
});

test("failure class, a child killed mid-batch: what it answered stands and the rest is charged", needsShebang, async () => {
  const ruby = stubRuby("killed", [
    "cat >/dev/null",
    READY,
    `printf '{"rel":"a.rb","ok":true,"errors":0,"length":1,"ast":{"t":"program","line":1}}\\n'`,
    "kill -9 $$",
  ]);
  const { out, lines } = await linesParsedHere(() => parseRuby(pair, { ruby, dimensions: RUBY_DIMENSIONS }));
  assert.deepEqual(shape(out), {
    version: "1.0.0", error: null, missingParser: null, stalled: null, truncated: false,
    results: [["a.rb", true, null, false, 1], ["b.rb", false, "no result", true, 1]],
  });
  assert.deepEqual(lines, []);
});

test("failure class, the idle guard: killed twice after its ready line, every file charged", needsShebang, async () => {
  const ruby = stubRuby("silent", ["cat >/dev/null", READY, "exec sleep 30"]);
  const { out, lines } = await linesParsedHere(() =>
    parseRuby(pair, { ruby, dimensions: RUBY_DIMENSIONS, guards: { idleMs: 1500 } })
  );
  assert.deepEqual(shape(out), {
    version: "1.0.0", error: "ruby went silent", missingParser: null, stalled: null, truncated: false,
    results: [["a.rb", false, "ruby went silent", true, 2], ["b.rb", false, "ruby went silent", true, 2]],
  });
  assert.deepEqual(lines, []);
});

test("failure class, the wall clock: a timeout is retried once and then charged", needsShebang, async () => {
  const ruby = stubRuby("wall", ["cat >/dev/null", READY, "exec sleep 30"]);
  const { out, lines } = await linesParsedHere(() =>
    parseRuby(pair, { ruby, dimensions: RUBY_DIMENSIONS, guards: { wallBaseMs: 1500, wallPerFileMs: 0 } })
  );
  const why = "ruby ran past its wall clock";
  assert.deepEqual(shape(out), {
    version: "1.0.0", error: why, missingParser: null, stalled: null, truncated: false,
    results: [["a.rb", false, why, true, 2], ["b.rb", false, why, true, 2]],
  });
  assert.deepEqual(lines, []);
});

test("failure class, the line cap: the run is truncated and nothing past the cap is counted", needsShebang, async () => {
  const ruby = stubRuby("linecap", [
    "cat >/dev/null",
    READY,
    `printf '{"rel":"a.rb","ok":true,"ast":{"t":"program","line":1,"pad":"${"x".repeat(200)}'`,
    "exec sleep 30",
  ]);
  const { out, lines } = await linesParsedHere(() =>
    parseRuby(pair, { ruby, dimensions: RUBY_DIMENSIONS, guards: { maxLineBytes: 64 } })
  );
  assert.deepEqual(shape(out), {
    version: "1.0.0", error: "line cap", missingParser: null, stalled: null, truncated: true,
    results: [["a.rb", false, "line cap", true, 1], ["b.rb", false, "line cap", true, 1]],
  });
  assert.deepEqual(lines, []);
});

test("facets that throw on a tree fall back on their own, and cost no row its sites", { ...needsRuby, ...needsShebang }, async () => {
  // A def whose name is no string throws in the facets visitor, which rides the
  // rows' walk, after an RSpec block the facets had already read: the fallback
  // answers, not the half-read facets, and the rows still answer. A check
  // asking for no rows gets the same fallback beside the tree it keeps.
  const abs = join(dir, "odd_facets_spec.rb");
  writeFileSync(abs, 'describe "x" do\n  it "y" do\n    begin\n      go\n    rescue => e\n    end\n  end\nend\n');
  const one = [{ rel: "a.rb", abs }];
  const ast = (await parseRuby(one)).results[0].program;
  assert.equal((await parseRuby(one, { dimensions: RUBY_DIMENSIONS })).results[0].facets.testRunner, "rspec");
  ast.statements.body.push({ t: "def", name: 5, line: 9 });
  const ruby = stubRuby("odd-facets", [
    "cat >/dev/null",
    READY,
    `printf '%s\\n' '${JSON.stringify({ rel: "a.rb", ok: true, errors: 0, length: 1, ast })}'`,
  ]);
  const fallback = { testRunner: null, testCalls: false };

  const scan = (await parseRuby(one, { ruby, dimensions: RUBY_DIMENSIONS })).results[0];
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.facets, fallback);
  assert.ok(Object.keys(scan.hits).length, "the fixture reaches a row");
  assert.deepEqual(scan.hits, collectHits(ast, RUBY_DIMENSIONS, { rel: "a.rb" }, { walker: walkRuby }));

  const check = (await parseRuby(one, { ruby })).results[0];
  assert.deepEqual(check.facets, fallback);
  assert.deepEqual(check.program, ast);
});

test("failure class, an unreadable file: the interpreter names the error class and the rest still count", needsRuby, async () => {
  const files = [{ rel: "gone.rb", abs: join(dir, "no-such-file.rb") }, { rel: "here.rb", abs: join(dir, "rescue_none.rb") }];
  const { out, lines } = await linesParsedHere(() => parseRuby(files, { dimensions: RUBY_DIMENSIONS }));
  const { version, ...rest } = shape(out);
  assert.match(version, /^\d+\.\d+/);
  assert.deepEqual(rest, {
    error: null, missingParser: null, stalled: null, truncated: false,
    results: [["gone.rb", false, "Errno::ENOENT", false, 1], ["here.rb", true, null, false, 1]],
  });
  assert.deepEqual(lines, []);
});

test("a shard whose worker cannot run its rows charges its files rather than losing them", needsRuby, async () => {
  // A row reaches the worker by key, so one the registry does not hold is the
  // one way the worker itself fails before it answers.
  const out = await parseRuby(pair, { dimensions: [{ key: "no_such_row", run() {} }] });
  assert.equal(out.results.length, 2);
  for (const r of out.results) {
    assert.equal(r.crashed, true);
    assert.match(r.error, /no_such_row/);
  }
});

test("a shard starts under a parent run as `node --input-type=module -e`", needsRuby, () => {
  // A thread inherits the parent's flags unless told otherwise, and this one
  // is legal on the parent and refused by a thread that loads a file.
  const lib = new URL("../plugins/anatomiya/lib/ruby.mjs", import.meta.url).href;
  const script = `const { parseRuby } = await import(${JSON.stringify(lib)});
const out = await parseRuby([{ rel: "a.rb", abs: ${JSON.stringify(join(dir, "rescue_none.rb"))} }], { dimensions: [] });
process.stdout.write(JSON.stringify(out.results.map((r) => [r.ok, r.error ?? null])));`;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(stdout, '[[true,null]]');
});

/** Whether a pid still names a process, a zombie included: only a reaped child is gone. */
function exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

test("a tree too large for a shard's held heap is read again on a full one, and the first child is stopped and reaped", { ...needsRuby, ...needsShebang }, async () => {
  // 600 KB, so inside the size cap, and the densest shape measured: a call
  // per four bytes outgrows the hold its size buys. The stand-in logs the pid
  // of every parse child, and the first one lingers after its answer, so a
  // child left running by the thread that died is still there to find.
  const home = mkdtempSync(join(dir, "held-"));
  const real = execFileSync("ruby", ["-e", "print RbConfig.ruby"], { encoding: "utf8" });
  const log = join(home, "pids");
  const ruby = join(home, "ruby");
  writeFileSync(
    ruby,
    [
      "#!/bin/sh",
      `case "$*" in *MAX_BYTES*) ;; *) exec '${real}' "$@" ;; esac`,
      `first=$(test -s '${log}' && echo no || echo yes)`,
      `echo $$ >> '${log}'`,
      `if [ "$first" = yes ]; then '${real}' "$@"; exec sleep 30; fi`,
      `exec '${real}' "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  const big = write("heap_heavy", Array.from({ length: 150_000 }, () => "a.b").join("\n") + "\n");
  const out = await parseRuby([big], { ruby, dimensions: RUBY_DIMENSIONS });

  assert.equal(out.results[0].ok, true, out.results[0].error);
  assert.equal(out.results[0].attempts, 1);
  assert.equal(out.error, null);
  const pids = readFileSync(log, "utf8").trim().split("\n").map(Number);
  assert.equal(pids.length, 2, "the held thread ran out and the batch was read again");
  assert.deepEqual(pids.filter(exists), [], "no child of either attempt is left, running or unreaped");
});

test("a held heap that runs out keeps the records already answered and reads again only the rest", { ...needsRuby, ...needsShebang }, async () => {
  // Two small files answer before the dense one outgrows the hold. The stand-in
  // keeps what each parse child was handed, by pid, in the order they started.
  const home = mkdtempSync(join(dir, "held-rest-"));
  const real = execFileSync("ruby", ["-e", "print RbConfig.ruby"], { encoding: "utf8" });
  const log = join(home, "pids");
  const ruby = join(home, "ruby");
  writeFileSync(
    ruby,
    [
      "#!/bin/sh",
      `case "$*" in *MAX_BYTES*) ;; *) exec '${real}' "$@" ;; esac`,
      `first=$(test -s '${log}' && echo no || echo yes)`,
      `echo $$ >> '${log}'`,
      `cat > '${home}/in.'$$`,
      `if [ "$first" = yes ]; then '${real}' "$@" < '${home}/in.'$$; exec sleep 30; fi`,
      `exec '${real}' "$@" < '${home}/in.'$$`,
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  const small = [write("held_small_a", "a = 1\n"), write("held_small_b", "b = 2\n")];
  const big = write("held_dense", Array.from({ length: 150_000 }, () => "a.b").join("\n") + "\n");
  const out = await parseRuby([...small, big], { ruby, dimensions: RUBY_DIMENSIONS, shards: 1 });

  assert.deepEqual(out.results.map((r) => [r.rel, r.ok, r.attempts]), [["held_small_a.rb", true, 1], ["held_small_b.rb", true, 1], ["held_dense.rb", true, 1]]);
  assert.equal(out.error, null);
  const pids = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(pids.length, 2, "the held thread ran out and a second child was started");
  const rels = (pid) => readFileSync(join(home, `in.${pid}`), "utf8").split("\0").filter((_, i) => i % 2 === 0).slice(0, -1);
  assert.deepEqual(rels(pids[0]), ["held_small_a.rb", "held_small_b.rb", "held_dense.rb"]);
  assert.deepEqual(rels(pids[1]), ["held_dense.rb"], "only the file with no record is read again");
});

test("a shard whose thread throws after its child started stops and reaps that child", needsShebang, async () => {
  // A fatal whose value cannot become a string throws inside the stream
  // handler, after the child is running and with its clocks on that thread.
  const home = mkdtempSync(join(dir, "throws-"));
  const log = join(home, "pid");
  const ruby = stubRuby("throws", [
    "cat >/dev/null",
    `echo $$ > '${log}'`,
    READY,
    `printf '{"fatal":{"toString":1,"valueOf":1}}\\n'`,
    "exec sleep 30",
  ]);
  const started = Date.now();
  const out = await parseRuby(pair, { ruby, dimensions: RUBY_DIMENSIONS });

  assert.ok(Date.now() - started < 15_000, "the child was stopped, not waited out");
  assert.deepEqual(out.results.map((r) => [r.rel, r.ok, Boolean(r.crashed), r.attempts]), [["a.rb", false, true, 1], ["b.rb", false, true, 1]]);
  assert.match(out.results[0].error, /primitive/);
  assert.equal(exists(Number(readFileSync(log, "utf8"))), false, "the child is gone, not running and not a zombie");
});
