/**
 * Which extensions belong to which engine, and the one question the parser
 * child asks about them.
 *
 * A leaf on purpose. `corpus.mjs` used to own the table, and it reaches git, so
 * the parser child could not read it without dragging git into all eight
 * processes. The child answered by carrying its own copy of the extension list,
 * which is the drift this module exists to remove: a JavaScript-shaped
 * extension added below is now in scope for the corpus and for the Flow retry
 * at once.
 */

/**
 * The engine that reads each extension. `jsx` is separate from `js` because the
 * two grammars disagree: `<div` is JSX in one and a type assertion in the other,
 * and `<string>x` is legal in `.ts` and not in `.tsx`.
 */
export const EXT_BY_LANG = {
  js: ["ts", "mts", "cts", "js", "mjs", "cjs"],
  jsx: ["tsx", "jsx"],
  ruby: ["rb", "rake", "gemspec", "jbuilder"],
};

// The extensions that carry types by their own grammar. oxc reads these
// natively, so a rejection in one of them is a syntax error rather than a
// dialect it declined.
const TYPED_EXT = new Set(["ts", "mts", "cts", "tsx"]);

const FLOW_EXT = [...EXT_BY_LANG.js, ...EXT_BY_LANG.jsx].filter((e) => !TYPED_EXT.has(e));
const MAY_HOLD_FLOW = new RegExp(`\\.(${FLOW_EXT.join("|")})$`);

/**
 * Whether a rejected file is worth handing to the Flow stripper.
 *
 * Flow lives in JavaScript files: a `.ts` file oxc rejects is broken rather than
 * written in a dialect, and blanking it would only hide the error.
 */
export const mayHoldFlow = (path) => MAY_HOLD_FLOW.test(path);
