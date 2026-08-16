import { walkRuby, constName, bodyOf, ownDef } from "./ruby.mjs";

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
    claim: "records are fetched with find_by and checked, not find",
    counterClaim: "records are fetched with find, and a missing record raises",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a Ruby file calling find, find!, find_by or find_by! on a constant receiver, with no block",
      blind: "a controller that wants the 404 from find is indistinguishable from one that forgot to check",
    },
    langs: ["ruby"],
    run(ast, add) {
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "call" || !/^find(_by)?!?$/.test(n.name)) return;
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
      sites: "a Ruby file declaring a class or module with a call, perform, execute or run method, on the instance or on self",
      blind: "a raise inside a helper the entry point calls is invisible from the entry method",
    },
    langs: ["ruby"],
    run(ast, add) {
      walkRuby(ast, (n, ctx) => {
        if (n.t !== "def" || !ctx.cls || !ENTRY.test(n.name)) return;
        // A def on any other receiver belongs to that object, not to this
        // class. `self` is not another object, and it is how a good deal of
        // Ruby spells an entry point.
        if (!ownDef(n)) return;
        let raises = false;
        walkRuby(n.body, (m, mctx) => {
          if (m.t !== "call" || m.name !== "raise" || m.receiver) return;
          // A raise inside a rescue is a translation of someone else's error,
          // not this method's choice about how it reports failure.
          if (mctx.ancestors.some((a) => a.t === "rescue")) return;
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
      sites: "a Ruby file declaring a method taking three or more named parameters, positional and keyword together. A splat, a double splat and a block are not named at the call site and are not counted",
      blind: null,
    },
    langs: ["ruby"],
    run(ast, add) {
      walkRuby(ast, (n) => {
        if (n.t !== "def" || !n.parameters) return;
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
      sites: "a Ruby file calling Time.now, DateTime.now, Date.today, current on any of the three, or now or today on Time.zone",
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
        if (r && r.t === "call" && r.name === "zone" && constName(r.receiver) === "Time" &&
            (n.name === "now" || n.name === "today")) {
          add({ node: site(n), conforming: true, where: where(ctx) });
        }
      });
    },
  },
];

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
