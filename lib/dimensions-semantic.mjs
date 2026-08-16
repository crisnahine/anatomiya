export const SEMANTIC_DIMENSIONS = [
  {
    key: "law_of_demeter",
    claim: "a call chain stays inside one type",
    // The inverse is a chain reaching through three types on purpose, which is
    // a defect rather than a house style anyone picked.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file holding at least one member-call chain of depth two or more, that is a.b().c() or a.b.c() where the outermost node is a call",
      blind: "a receiver whose type did not resolve is not counted as a distinct type, so an unresolved chain reads as conforming and a violation there is invisible",
    },
    tier: "semantic",
    langs: ["js", "jsx"],
    run({ ts, checker, source }, add) {
      const seen = new Set();

      const visit = (node) => {
        if (ts.isCallExpression(node) && !seen.has(node)) {
          const receivers = chainReceivers(ts, node);
          if (receivers.length >= 2) {
            // Outermost wins: every node inside this chain is marked so the
            // walk below does not count the same chain again from halfway up.
            markChain(ts, node, seen);
            const types = new Set(
              receivers
                .map((r) => widened(ts, checker, r))
                .filter((name) => name !== null)
            );
            add({ conforming: types.size <= 1, where: enclosingName(ts, node) });
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    },
  },
];

/**
 * The receiver of each link in a member-call chain, outermost first.
 *
 * `a.b().c()` gives the receivers of `c` and of `b`, which is what decides how
 * many types the expression reaches through.
 */
/**
 * The expression inside its wrappers.
 *
 * `t.maybe!.go()` and `(t.inner()).go()` are chains, and a walk that stops at
 * the wrapper collects one receiver and counts nothing. Non-null assertions in
 * chains are routine under strictNullChecks, so this was silently dropping the
 * shapes the claim is most about. The syntactic side calls the same idea
 * `value()`; both exist because the wrapper is not the value.
 */
function inner(ts, node) {
  let at = node;
  while (at && (ts.isNonNullExpression(at) || ts.isParenthesizedExpression(at) || ts.isAsExpression?.(at))) {
    at = at.expression;
  }
  return at;
}

function chainReceivers(ts, node) {
  const out = [];
  let at = inner(ts, node);
  while (at) {
    if (ts.isCallExpression(at)) {
      at = inner(ts, at.expression);
      continue;
    }
    if (ts.isPropertyAccessExpression(at)) {
      out.push(at.expression);
      at = inner(ts, at.expression);
      continue;
    }
    break;
  }
  return out;
}

function markChain(ts, node, seen) {
  let at = node;
  while (at) {
    seen.add(at);
    const bare = inner(ts, at);
    if (bare !== at) {
      seen.add(bare);
      at = bare;
      continue;
    }
    if (ts.isCallExpression(at) || ts.isPropertyAccessExpression(at)) {
      at = at.expression;
      continue;
    }
    break;
  }
}

/**
 * A receiver's type, widened off its literal.
 *
 * Without the widening `" a ".trim()` and `"b".trim()` are two distinct literal
 * types and every string chain in every repository reads as a violation. An
 * unresolved type answers null and drops out of the count, which under-counts
 * violations rather than inventing them, and is why this row is `partial`.
 */
function widened(ts, checker, node) {
  const type = checker.getTypeAtLocation(node);
  if (!type) return null;
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
  const base = checker.getBaseTypeOfLiteralType(type);
  return checker.typeToString(base);
}

function enclosingName(ts, node) {
  let at = node.parent;
  while (at) {
    if (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) return at.name?.getText() ?? null;
    at = at.parent;
  }
  return null;
}
