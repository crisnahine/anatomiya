/**
 * Capability routing: whether a cross-cutting concern goes through the
 * repository's own module or straight at the platform.
 *
 * The wrapper is learned per file from its imports: a relative import whose
 * filename stem carries the category's vocabulary is the repository's own
 * module for that concern. The direct forms are a closed table. A repository
 * with no wrapper-shaped file is never asked the question at all: the reducer
 * offers a row only where `capabilitiesIn` saw the vocabulary in the corpus,
 * the same posture as a framework claim (C8), so no map carries a line that can
 * only ever read zero.
 */
import { walk, declName } from "./walk.mjs";

/** A stem's words: delimiters and camel humps both split. */
export function stemWords(stem) {
  return stem
    .split(/[-_.]/)
    .flatMap((w) => w.split(/(?=[A-Z])/))
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

export const CAPABILITY_WORDS = {
  logging: new Set(["log", "logger", "logging"]),
  network: new Set(["client", "http", "api", "request", "fetcher"]),
  env: new Set(["config", "env", "settings"]),
};

export const fileStem = (rel) => {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

/** Local names bound by relative imports whose stem carries the vocabulary. */
function wrapperBindings(program, words) {
  const names = new Set();
  walk(program, (n) => {
    if (n.type !== "ImportDeclaration") return;
    const spec = n.source?.value;
    if (typeof spec !== "string" || !spec.startsWith(".")) return;
    if (!stemWords(fileStem(spec)).some((w) => words.has(w))) return;
    for (const s of n.specifiers || []) if (s.local?.name) names.add(s.local.name);
  });
  return names;
}

/** Local names bound by importing exactly this package. */
function packageBindings(program, pkg) {
  const names = new Set();
  walk(program, (n) => {
    if (n.type !== "ImportDeclaration" || n.source?.value !== pkg) return;
    for (const s of n.specifiers || []) if (s.local?.name) names.add(s.local.name);
  });
  return names;
}

const rootName = (node) => {
  let n = node;
  while (n && n.type === "MemberExpression") n = n.object;
  return n && n.type === "Identifier" ? n.name : null;
};

export const CAPABILITY_DIMENSIONS = [
  {
    key: "route_logging",
    capability: "logging",
    tier: "syntactic",
    claim: "logging goes through the repository's own logger, not the console",
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file calling console, or calling through a binding imported from a relative module whose filename says log, logger or logging",
      blind: "a logging call behind a helper with another name or a re-export is not seen, and the wrapper's own console call counts against it",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      const wrap = wrapperBindings(program, CAPABILITY_WORDS.logging);
      walk(program, (n, ctx) => {
        if (n.type !== "CallExpression") return;
        const c = n.callee;
        if (c?.type === "MemberExpression" && c.object?.type === "Identifier" && c.object.name === "console") {
          return add({ node: n, conforming: false, where: declName(ctx.fn) });
        }
        const root = c?.type === "Identifier" ? c.name : rootName(c);
        if (root && wrap.has(root)) add({ node: n, conforming: true, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "route_network",
    capability: "network",
    tier: "syntactic",
    claim: "network calls go through the repository's own client, not fetch directly",
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file calling fetch or an axios binding, or calling through a binding imported from a relative module whose filename says client, http, api, request or fetcher",
      blind: "a shadowed fetch still counts, and a client behind another name is not seen",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      const wrap = wrapperBindings(program, CAPABILITY_WORDS.network);
      const axios = packageBindings(program, "axios");
      walk(program, (n, ctx) => {
        if (n.type !== "CallExpression") return;
        const c = n.callee;
        if (c?.type === "Identifier" && c.name === "fetch") {
          return add({ node: n, conforming: false, where: declName(ctx.fn) });
        }
        const root = c?.type === "Identifier" ? c.name : rootName(c);
        if (!root) return;
        if (axios.has(root)) return add({ node: n, conforming: false, where: declName(ctx.fn) });
        if (wrap.has(root)) add({ node: n, conforming: true, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "route_env",
    capability: "env",
    tier: "syntactic",
    claim: "environment reads go through the repository's own config module, not process.env",
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file reading or destructuring properties off process.env, or reading off a binding imported from a relative module whose filename says config, env or settings",
      blind: "an env read behind a helper, or destructured from process.env once and read as locals, is one site rather than each use",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      const wrap = wrapperBindings(program, CAPABILITY_WORDS.env);
      const isProcessEnv = (v) =>
        v?.type === "MemberExpression" && v.object?.type === "Identifier" &&
        v.object.name === "process" && !v.computed && v.property?.name === "env";
      walk(program, (n, ctx) => {
        // `const { PORT } = process.env` reads one name per pattern property,
        // and missing it inflates the ratio in the dangerous direction.
        if (n.type === "VariableDeclarator" && n.id?.type === "ObjectPattern" && isProcessEnv(n.init)) {
          for (const p of n.id.properties || []) add({ node: p, conforming: false, where: declName(ctx.fn) });
          return;
        }
        if (n.type !== "MemberExpression") return;
        const o = n.object;
        if (o?.type === "MemberExpression" && o.object?.type === "Identifier" &&
            o.object.name === "process" && !o.computed && o.property?.name === "env") {
          return add({ node: n, conforming: false, where: declName(ctx.fn) });
        }
        // Only the outermost member of a wrapper chain is the site, or
        // config.db.host counts three times for one read.
        const parent = ctx.ancestors[ctx.ancestors.length - 1];
        if (parent?.type === "MemberExpression" && parent.object === n) return;
        const root = rootName(n);
        if (root && wrap.has(root)) add({ node: n, conforming: true, where: declName(ctx.fn) });
      });
    },
  },
];
