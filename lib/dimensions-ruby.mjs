import { walkRuby, constName, bodyOf, ownDef } from "./ruby-walk.mjs";
import { CAPABILITY_WORDS, implementsCapability, stemWords } from "./dimensions-capability.mjs";

/**
 * Ruby dimensions, in the shape `reduce.mjs` already folds: one `add` per
 * candidate site, `conforming` decided per site, never per file.
 *
 * Every claim here had to survive one test before it was written down: could a
 * repository plausibly sit anywhere between 0 and 1 on it? The JS side shipped
 * `module_state_const`, which scored 620 of 620 on a real repository because it
 * measures a language default rather than a house style, and a directive that
 * cannot be violated teaches an agent nothing. So there is no dimension here
 * for "models inherit from ApplicationRecord" or "workers define perform".
 */

const CALLBACK =
  /^(before|after|around)_(validation|save|create|update|destroy|commit|rollback|touch|initialize|find)$/;
const ENTRY = /^(call|perform|execute|run)$/;
const SIDEKIQ_JOB = /^Sidekiq::(Worker|Job)$/;
// The reads and the constructions that go through the application zone. Without
// the last three, a repository that builds its times the right way reads as
// having no conforming construction at all.
const ZONED = /^(now|today|local|parse|at)$/;
const MODEL_BASE = /(^|::)(ApplicationRecord|ActiveRecord::Base|ApplicationRecord::Base)$/;

const where = (ctx) => (ctx.def && ctx.def.name) || (ctx.cls && ctx.cls.name) || null;

/**
 * The `node` every consumer destructures off a hit, in the one shape the JS
 * dimensions also emit.
 *
 * `start` and `end` are null rather than absent: B5 forbids an offset here at
 * all, and an absent bound would make a consumer's `source.slice(start, end)`
 * hand back the whole file as the matched text. `type` plus `name` is what
 * stays of a site's identity without one.
 */
const site = (n) => ({
  type: n.t,
  name: typeof n.name === "string" ? n.name : null,
  line: typeof n.line === "number" ? n.line : null,
  start: null,
  end: null,
});

/**
 * Ruby's own exception classes, as of 3.4: everything
 * `ObjectSpace.each_object(Class) { |c| c < Exception }` names, minus the
 * platform-generated `Errno::*` family, which the prefix covers, and minus
 * `fatal`, which cannot be spelled in source.
 *
 * A closed table rather than a name test, because `QuotaExceededError` is an
 * error by its name and by nothing else: a repository that gives its errors a
 * base of their own must keep every subclass as a site, or the row stops
 * stating in exactly the directories it is for.
 */
const RUBY_ERROR = new Set([
  "Exception", "StandardError", "RuntimeError", "ArgumentError", "TypeError",
  "NameError", "NoMethodError", "IndexError", "KeyError", "RangeError",
  "FloatDomainError", "ZeroDivisionError", "IOError", "EOFError", "RegexpError",
  "ThreadError", "FiberError", "LocalJumpError", "FrozenError", "StopIteration",
  "ClosedQueueError", "UncaughtThrowError", "NoMatchingPatternError",
  "NoMatchingPatternKeyError", "EncodingError", "SecurityError", "NotImplementedError",
  "SystemCallError", "SystemExit", "SystemStackError", "NoMemoryError",
  "ScriptError", "LoadError", "SyntaxError", "SignalException", "Interrupt",
  "Encoding::CompatibilityError", "Encoding::ConverterNotFoundError",
  "Encoding::InvalidByteSequenceError", "Encoding::UndefinedConversionError",
  "Math::DomainError", "Regexp::TimeoutError", "IO::TimeoutError",
  "Ractor::Error", "Ractor::ClosedError", "Ractor::IsolationError",
  "Ractor::MovedError", "Ractor::RemoteError", "Ractor::UnsafeError",
]);

export const isRubyError = (base) => base.startsWith("Errno::") || RUBY_ERROR.has(base);

/**
 * A class or module's own name as the repository spells it, whichever way its
 * namespace is written: `module Api; module V1; class BaseController` and
 * `class Api::V1::BaseController` both read back the same.
 */
export const qualifiedName = (ctx, n) =>
  [...ctx.stack.filter((x) => x.t === "class" || x.t === "module"), n]
    .map((x) => constName(x.constant_path) ?? x.name)
    .filter(Boolean)
    .join("::");

/**
 * The class bodies that directly include Sidekiq's worker mixin.
 *
 * Collected in a pass of its own because the include may sit below the def, and
 * `walkRuby` visits a node before pushing it, so a call inside a class body
 * already sees its enclosing class.
 *
 * Direct includes only. A worker handed the mixin by its own base class still
 * counts, which over-counts violations and so suppresses a row rather than
 * stating a convention nobody holds. Measured, all 73 `perform` sites on the
 * repository this was found on include the mixin directly.
 */
function sidekiqBodies(ast) {
  const bodies = new Set();
  walkRuby(ast, (n, ctx) => {
    if (n.t !== "call" || n.receiver || n.name !== "include") return;
    if (ctx.def || !ctx.cls) return;
    for (const arg of (n.arguments && n.arguments.arguments) || []) {
      if (SIDEKIQ_JOB.test(constName(arg) || "")) bodies.add(ctx.cls);
    }
  });
  return bodies;
}

export const RUBY_DIMENSIONS = [
  {
    key: "rescue_uses_error",
    tier: "syntactic",
    claim: "rescue blocks use the error they caught",
    counterClaim: null, // discarding the error is an absence, not a style anyone picked
    precision: "precise",
    applicabilityPredicate: {
      sites: "a Ruby file holding at least one rescue clause, counting each link of a multi-rescue chain",
      blind: null,
    },
    langs: ["ruby"],
    run(ast, add) {
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "rescue") return;
        const name = n.reference && n.reference.name;
        const stmts = n.statements;
        const handled = !isEmpty(stmts) && (readsLocal(stmts, name) || reraises(stmts));
        add({ node: site(n), conforming: handled, where: where(ctx) });
      });
    },
  },

  {
    key: "record_lookup",
    tier: "syntactic",
    framework: "rails",
    // The axis is what a miss does, not which method name was typed:
    // `find_by` answers nil and the caller decides, while `find` and `find_by!`
    // both raise ActiveRecord::RecordNotFound. `find_by!` is
    // `where(...).take!` in ActiveRecord's own source, so counting it as
    // conforming would put it in the numerator of both sides at once.
    claim: "a record that may be missing is fetched with find_by and checked, not fetched with one that raises",
    counterClaim: "records are fetched with find, and a missing record raises",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a Ruby file calling find, find_by or find_by! on a constant receiver, with no block",
      blind: "a controller that wants the 404 from find is indistinguishable from one that forgot to check",
    },
    langs: ["ruby"],
    run(ast, add) {
      // `find!` is not an ActiveRecord method, so the sentence no longer names
      // it and the pattern no longer matches it.
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "call" || !/^(find|find_by!?)$/.test(n.name)) return;
        // A constant receiver is what separates a model lookup from
        // Enumerable#find, which takes a block and is a different method
        // entirely despite the name.
        if (!constName(n.receiver) || n.block) return;
        add({ node: site(n), conforming: n.name === "find_by", where: where(ctx) });
      });
    },
  },

  {
    key: "model_callbacks",
    tier: "syntactic",
    claim: "models keep behaviour out of lifecycle callbacks",
    counterClaim: "models register their behaviour in lifecycle callbacks",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a Ruby file declaring a class whose superclass is an ActiveRecord model base",
      blind: "an included concern can register callbacks from a file this one never names",
    },
    langs: ["ruby"],
    run(ast, add) {
      walkRuby(ast, (n) => {
        if (n.t !== "class" || !MODEL_BASE.test(constName(n.superclass) || "")) return;
        let registers = false;
        walkRuby(n.body, (m, mctx) => {
          // Only the class's own body: a callback in a nested class belongs to
          // that class, and one inside a method is not a registration at all.
          if (m.t !== "call" || mctx.enclosing !== null || m.receiver) return;
          if (CALLBACK.test(m.name)) registers = true;
        });
        add({ node: site(n), conforming: !registers, where: n.name });
      });
    },
  },

  {
    key: "service_result_shape",
    tier: "syntactic",
    claim: "service entry points return their failure instead of raising",
    counterClaim: "service entry points raise on failure",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a Ruby file declaring a class or module with a call, perform, execute or run method, on the instance or on self; a perform in a body that directly includes Sidekiq::Worker or Sidekiq::Job is not one, because returning is how a job reports success",
      blind: "a raise inside a helper the entry point calls is invisible from the entry method",
    },
    langs: ["ruby"],
    run(ast, add) {
      // Collected first, because the include may sit below the def.
      const sidekiq = sidekiqBodies(ast);
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "def" || !ctx.cls || !ENTRY.test(n.name)) return;
        // A def on any other receiver belongs to that object, not to this
        // class. `self` is not another object, and it is how a good deal of
        // Ruby spells an entry point.
        if (!ownDef(n)) return;
        // A Sidekiq job that returns instead of raising is acked as successful:
        // never retried, never in the dead set, never in Sentry. Raising is how
        // a worker reports failure, so the claim's remedy is the one thing it
        // must not do.
        if (n.name === "perform" && sidekiq.has(ctx.cls)) return;
        let raises = false;
        walkRuby(n.body, (m, mctx) => {
          if (m.t !== "call" || m.name !== "raise" || m.receiver) return;
          // A raise inside a rescue is a translation of someone else's error,
          // not this method's choice about how it reports failure.
          if (mctx.ancestors.some((a) => a.t === "rescue")) return;
          // `raise ActiveRecord::Rollback` unwinds the transaction block, which
          // swallows it, and the method still returns. It is control flow, not
          // a service raising its failure.
          if (constName((m.arguments?.arguments ?? [])[0]) === "ActiveRecord::Rollback") return;
          raises = true;
        });
        add({ node: site(n), conforming: !raises, where: n.name });
      });
    },
  },

  {
    key: "keyword_params",
    tier: "syntactic",
    claim: "methods taking three or more arguments name them with keywords",
    counterClaim: null, // nothing is gained at the call site by being told to drop the names
    precision: "precise",
    applicabilityPredicate: {
      sites: "a Ruby file declaring a method taking three or more named parameters, positional and keyword together. A splat, a double splat and a block are not named at the call site and are not counted. Three methods their own callers reach positionally are not sites: []=, which cannot take keywords at all, validate_each, and perform in a body that directly includes Sidekiq::Worker or Sidekiq::Job",
      blind: null,
    },
    langs: ["ruby"],
    run(ast, add) {
      const sidekiq = sidekiqBodies(ast);
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "def" || !n.parameters) return;
        // `s[a: 1] = 2` does not parse: "unexpected keyword arg given in index
        // assignment". ActiveModel calls `validate_each(record, attribute,
        // value)` positionally from `EachValidator#validate`.
        if (n.name === "[]=" || n.name === "validate_each") return;
        // Sidekiq reaches `perform` through `instance.perform(*cloned_args)`, a
        // splat of a JSON array, and in Ruby 3 a splatted Hash is never
        // keywords. Gated on the mixin rather than on the name, because
        // ActiveJob does carry keywords through and `perform` is an ordinary
        // method name. `def self.perform` is not what Sidekiq calls.
        if (n.name === "perform" && !n.receiver && ctx.cls && sidekiq.has(ctx.cls)) return;
        const p = n.parameters;
        const positional = len(p.requireds) + len(p.optionals) + len(p.posts);
        const total = positional + len(p.keywords);
        // Two arguments read fine positionally; the convention is about the
        // point where a call site stops being readable.
        if (total < 3) return;
        add({ node: site(n), conforming: positional === 0, where: n.name });
      });
    },
  },

  {
    key: "zone_aware_time",
    tier: "syntactic",
    framework: "rails",
    claim: "the current time is read through the application time zone",
    // Time.now is right in plain Ruby and a drifting timestamp under Rails, and
    // the predicate cannot see which of the two it is standing in.
    counterClaim: null,
    precision: "precise",
    applicabilityPredicate: {
      sites: "a Ruby file calling Time.now, DateTime.now, Time.new, DateTime.new, Date.today, current on any of the three, or now, today, local, parse or at on Time.zone",
      blind: null,
    },
    langs: ["ruby"],
    run(ast, add) {
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "call") return;
        const recv = constName(n.receiver);
        if (recv) {
          if ((recv === "Time" || recv === "DateTime") && n.name === "now") {
            return add({ node: site(n), conforming: false, where: where(ctx) });
          }
          // `DateTime.new(2026, 8, 20, 9, 0, 0, 'PST')` always resolves to
          // UTC-08:00 and `Time.new(..., '-08:00')` reports utc_offset -28800,
          // so the application zone never reaches the value. Any arity: a bare
          // `Time.new` is `Time.now` under another name.
          if ((recv === "Time" || recv === "DateTime") && n.name === "new") {
            return add({ node: site(n), conforming: false, where: where(ctx) });
          }
          if (recv === "Date" && n.name === "today") {
            return add({ node: site(n), conforming: false, where: where(ctx) });
          }
          if (/^(Time|Date|DateTime)$/.test(recv) && n.name === "current") {
            return add({ node: site(n), conforming: true, where: where(ctx) });
          }
          return;
        }
        // Time.zone.now, where the inner Time.zone call matches no rule and so
        // is not a second candidate for the same read.
        const r = n.receiver;
        if (r && r.t === "call" && r.name === "zone" && constName(r.receiver) === "Time" && ZONED.test(n.name)) {
          add({ node: site(n), conforming: true, where: where(ctx) });
        }
      });
    },
  },

  {
    key: "logger_over_puts",
    tier: "syntactic",
    capability: "logging",
    claim: "output goes through a logger, not puts",
    counterClaim: null, // a repository with no logger is never asked (C8), so the other side has no sites
    precision: "partial",
    applicabilityPredicate: {
      sites: "a Ruby file calling puts, print, p, pp or warn with no receiver, or calling through a logger receiver; the file whose own stem is nothing but the logging vocabulary implements the routing rather than following it and is not a site",
      blind: "output behind a helper, and a CLI that writes to stdout on purpose, look the same from here",
    },
    langs: ["ruby"],
    run(ast, add, { rel } = {}) {
      // The module that implements the routing is not one of its own sites.
      if (implementsCapability(rel, "logging")) return;
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "call") return;
        if (!n.receiver && LOG_DIRECT.test(n.name)) {
          return add({ node: site(n), conforming: false, where: where(ctx) });
        }
        if (loggerReceiver(n.receiver)) add({ node: site(n), conforming: true, where: where(ctx) });
      });
    },
  },

  {
    key: "http_through_client",
    tier: "syntactic",
    capability: "network",
    claim: "HTTP goes through the repository's own client, not Net::HTTP",
    counterClaim: null, // same as logger_over_puts: no wrapper means the question is never asked
    precision: "partial",
    applicabilityPredicate: {
      sites: "a Ruby file calling Net::HTTP or URI.open, or making a verb-shaped call (get, post, put, patch, delete, head, request, call, perform, execute, fetch) through a constant or variable named client, http, api, request or fetcher; the file whose own stem is nothing but that vocabulary is the client itself and is not a site",
      blind: "a client behind another name or a non-verb method is not seen, and a model that happens to be called Client with a verb-named scope still counts",
    },
    langs: ["ruby"],
    run(ast, add, { rel } = {}) {
      // The module that implements the routing is not one of its own sites.
      if (implementsCapability(rel, "network")) return;
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "call") return;
        const recv = constName(n.receiver);
        if (recv === "Net::HTTP" || (recv && recv.startsWith("Net::HTTP::"))) {
          return add({ node: site(n), conforming: false, where: where(ctx) });
        }
        if (recv === "URI" && n.name === "open") {
          return add({ node: site(n), conforming: false, where: where(ctx) });
        }
        // The verb table is what keeps a Rails model named Client from turning
        // its every find and update into a conforming HTTP site.
        if (HTTP_VERB.test(n.name) && clientReceiver(n.receiver, recv)) {
          add({ node: site(n), conforming: true, where: where(ctx) });
        }
      });
    },
  },

  {
    key: "class_base",
    tier: "syntactic",
    learnedClasses: true,
    // The class is a constant out of the repository's own source, so the
    // sentence it fills is encoded before it is rendered.
    learnedFromSource: true,
    claim: "classes here inherit <style>",
    counterClaim: null, // the other side is another base, which the learning already picks
    precision: "precise",
    applicabilityPredicate: {
      sites: "a Ruby class declaration whose superclass is a constant, plain or scoped, and also a top-level class naming no superclass at all, which is a site conforming to no base and is where the forgotten inheritance is caught. A class naming a superclass that is not a constant chose one anyway and is not an omission; neither is a class inside another class, nor a reopening, in the same file, of a class that names its superclass in the part that carries it. A class whose superclass is one of Ruby's own exception classes is not a site at all",
      blind: null,
    },
    langs: ["ruby"],
    run(ast, add) {
      // Two passes, because a class written in two parts declares its
      // superclass in whichever part carries it, and that part may be the one
      // below. Same rule H16 gave the include-less body.
      const bare = [];
      const declared = new Set();
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "class") return;
        const self = qualifiedName(ctx, n);
        // A superclass naming no constant is still a superclass somebody
        // chose. Measured: `ActiveRecord::Migration[7.2]` is an index call, so
        // counting it as an omission took one repository's db/migrate from 41
        // of 41 to 41 of 576.
        if (n.superclass) {
          declared.add(self);
          const base = constName(n.superclass);
          if (!base) return;
          // Ruby refuses to raise a class that is not an Exception, so an error
          // class cannot inherit whatever the area learned: conforming makes it
          // unraisable. Only the language's own, so a repository that gives its
          // errors a base of their own keeps every subclass.
          if (isRubyError(base)) return;
          // The site's own qualified name, for the fold: `class X < X` is a
          // NameError, and the class an area learned is counted as a site of
          // its own row. Deciding it needs the learned class, which only the
          // fold has.
          add({ node: site(n), conforming: false, where: n.name, class: base, self });
          return;
        }
        // A class inside another class is that class's helper rather than a
        // peer of the models the claim is about.
        if (ctx.cls?.t === "class") return;
        bare.push({ node: n, self, where: n.name });
      });
      for (const b of bare) {
        if (declared.has(b.self)) continue;
        // No class key, so it votes for nothing and conforms to nothing. The
        // omission is the violation an agent actually commits: a PORO dropped
        // into app/models, rather than a class inheriting the wrong base.
        add({ node: site(b.node), conforming: false, where: b.where, self: b.self });
      }
    },
  },

  {
    key: "module_include",
    tier: "syntactic",
    learnedClasses: true,
    learnedFromSource: true,
    // The site is the body, not the constant: a class including two modules can
    // never conform above a half if each include is its own site.
    groupedSites: true,
    claim: "classes here include <style>",
    counterClaim: null, // the other side is another module, which the learning already picks
    precision: "precise",
    applicabilityPredicate: {
      sites: "a Ruby class or module body that includes something, counted once each, and a class body that includes nothing, names no superclass and is not nested inside another class, which is a site conforming to no module and is where the forgotten include is caught. A module including nothing is namespacing, a subclass may be handed the mixin by its base, and a class inside a class is that class's helper, so none of those three is a site. Nor is a body that prepends or extends a constant, which declared a mixin by another route, nor a reopening of a class that declares one elsewhere in the file. A call inside a method runs when the method does and is not a mixin the body declares",
      blind: null,
    },
    langs: ["ruby"],
    run(ast, add) {
      // Every body is registered as it is walked, so a body that declares no
      // mixin is still a site. Emitting a hit only where an include already sat
      // made the omission invisible, which is the violation that actually
      // happens: an agent forgets the include rather than writing a wrong one.
      const bodies = new Map();
      // A short name is not an identity: `A::Worker` and `B::Worker` in one file
      // are two bodies, and told apart by `Worker` alone they fingerprint alike.
      const qualify = (ctx, n) =>
        [...ctx.stack.filter((x) => x.t === "class" || x.t === "module"), n]
          .map((x) => x.name)
          .filter(Boolean)
          .join("::");
      walkRuby(ast, (n, ctx) => {
        if (n.t === "class" || n.t === "module") {
          // `ctx.cls` is the enclosing body, since the walk visits before it
          // pushes. A module namespaces what it holds; a class owns it.
          if (!bodies.has(n)) {
            const name = qualify(ctx, n);
            bodies.set(n, {
              node: n,
              name,
              ownedByClass: ctx.cls?.t === "class",
              group: bodies.size + 1,
              hits: [],
              // `prepend` and `extend` put the module somewhere else in the
              // ancestry, so the body declared a mixin either way.
              declares: false,
            });
          }
          return;
        }
        if (n.t !== "call" || n.receiver) return;
        if (n.name !== "include" && n.name !== "prepend" && n.name !== "extend") return;
        const body = ctx.def || !ctx.cls ? null : bodies.get(ctx.cls);
        if (!body) return;
        if (n.name !== "include") {
          if ((n.arguments?.arguments ?? []).some((arg) => constName(arg))) body.declares = true;
          return;
        }
        // One hit per constant, because `include A, B` mixes in both and each
        // is a vote; the group is what keeps the body counting as one site.
        for (const arg of (n.arguments && n.arguments.arguments) || []) {
          const mixin = constName(arg);
          if (mixin) {
            body.hits.push({ node: site(n), conforming: false, where: where(ctx), class: mixin, group: body.group });
          }
        }
      });
      // One class written in two parts is one class, and the part carrying the
      // mixins is where it declared them.
      const declared = new Set(
        [...bodies.values()].filter((b) => b.hits.length || b.declares).map((b) => b.name)
      );
      for (const body of bodies.values()) {
        if (body.hits.length) {
          for (const hit of body.hits) add(hit);
          continue;
        }
        // A namespacing module, a subclass and a nested helper each have
        // somewhere else to have got the mixin, and each was a wrong finding on
        // the corpus before it was excluded.
        if (body.node.t !== "class" || body.ownedByClass || body.node.superclass) continue;
        if (declared.has(body.name)) continue;
        // No class key, so it votes for nothing and conforms to nothing.
        add({ node: site(body.node), conforming: false, where: body.name || null, group: body.group });
      }
    },
  },
];

const LOG_DIRECT = /^(puts|print|p|pp|warn)$/;
const HTTP_VERB = /^(get|post|put|patch|delete|head|request|call|perform|execute|fetch)$/;

/** A receiver that is a logger: `logger.info`, `Rails.logger.warn`, `@logger.debug`. */
function loggerReceiver(r) {
  if (!r) return false;
  if (r.t === "call" && r.name === "logger") return true;
  const name = typeof r.name === "string" ? r.name.replace(/^@+/, "") : null;
  return (r.t === "local_variable_read" || r.t === "instance_variable_read") && name === "logger";
}

/** A receiver named in the network vocabulary: `ApiClient.get`, `client.post`. */
function clientReceiver(r, recv) {
  if (!r) return false;
  const words = CAPABILITY_WORDS.network;
  if (recv) {
    const last = recv.slice(recv.lastIndexOf(":") + 1);
    return stemWords(last).some((w) => words.has(w));
  }
  // A bare `client` is a method call to prism, not a local, so the receiverless
  // call is the same vocabulary check the variable forms get. A variable named
  // exactly `http` is the raw handle Net::HTTP.start yields, not a wrapper.
  if (r.t === "local_variable_read" || r.t === "instance_variable_read" || (r.t === "call" && !r.receiver)) {
    const name = typeof r.name === "string" ? r.name.replace(/^@+/, "") : "";
    if (name === "http" && r.t !== "call") return false;
    return stemWords(name).some((w) => words.has(w));
  }
  return false;
}

function len(list) {
  return Array.isArray(list) ? list.length : 0;
}

function isEmpty(stmts) {
  return bodyOf(stmts).length === 0;
}

function readsLocal(stmts, name) {
  if (!name) return false;
  let used = false;
  walkRuby(stmts, (n) => {
    if (n.t === "local_variable_read" && n.name === name) used = true;
  });
  return used;
}

function reraises(stmts) {
  let found = false;
  walkRuby(stmts, (n) => {
    if (n.t === "call" && n.name === "raise" && !n.receiver) found = true;
  });
  return found;
}
