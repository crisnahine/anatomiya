import { walk, isFunctionLike, declName } from "./walk.mjs";

/**
 * JSX dimensions, same contract as `dimensions.mjs`: one claim, one `add` per
 * candidate site, ratio over candidates.
 *
 * All five declare `langs: ["jsx"]` and never `["js","jsx"]`. `reduce.mjs`
 * measures a dimension's applicability against `langFileCount`, the files of
 * its own languages, so a JSX-only dimension in a mixed area is judged against
 * that area's .tsx/.jsx files. One measured repository holds 1,638 .tsx among
 * 2,356 files: declaring both languages measures every JSX claim against the
 * .ts files it can never speak about and suppresses all five as narrow
 * predicates.
 *
 * Every claim here was kept for measured spread across four React
 * repositories, not for how cleanly it detects. Each spans at least 0.66
 * between its lowest and highest, and each states a directive somewhere and is
 * suppressed for a real reason somewhere else. The ones dropped were flat
 * (`img` alt at 0.987 to 1.000, list `key` at 0.971 to 1.000, both already
 * lint-enforced) or too sparse to clear the evidence gate in any single area.
 */

const HOST = /^[a-z]/; // JSX resolves a lowercase element name to a host tag
const HANDLER_PROP = /^on[A-Z]/;

/**
 * The element's own name. A member element is its LAST segment, so
 * `<Menu.Item/>` is `Item`; reading the object segment misnames `<ns.div/>`.
 * A namespaced element (`<svg:rect/>`) is never a component, so it is null.
 */
/**
 * Whether an opening element names a DOM tag rather than a component.
 *
 * Only a bare lowercase identifier is a host tag. A member expression resolves
 * through a binding whatever its last segment is called, so `<Calendar.default/>`
 * is a component; reading the last segment called it a `div`.
 */
export function isHostElement(node) {
  const n = node && (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement")
    ? node.name
    : node;
  if (!n) return false;
  if (n.type === "JSXMemberExpression") return false;
  if (n.type === "JSXNamespacedName") return true;
  return n.type === "JSXIdentifier" && HOST.test(n.name ?? "");
}

export function jsxName(node) {
  if (!node) return null;
  const n = node.type === "JSXOpeningElement" || node.type === "JSXClosingElement"
    ? node.name
    : node;
  if (!n) return null;
  if (n.type === "JSXIdentifier") return n.name ?? null;
  if (n.type === "JSXMemberExpression") {
    let c = n;
    while (c && c.type === "JSXMemberExpression") c = c.property;
    return (c && c.name) ?? null;
  }
  return null;
}

/**
 * `aria-label` arrives as ONE JSXIdentifier whose name carries the hyphen;
 * `xlink:href` arrives as a JSXNamespacedName. Reading `a.name.name` loses the
 * second, which either throws inside a dimension or drops the attribute.
 */
export function attrName(a) {
  if (!a || a.type !== "JSXAttribute") return null;
  const n = a.name;
  if (!n) return null;
  if (n.type === "JSXIdentifier") return n.name ?? null;
  if (n.type === "JSXNamespacedName" && n.namespace && n.name) {
    return `${n.namespace.name}:${n.name.name}`;
  }
  return null;
}

const calleeName = (c) => {
  if (!c) return null;
  if (c.type === "Identifier") return c.name ?? null;
  if (c.type === "MemberExpression" && !c.computed && c.property) return c.property.name ?? null;
  return null;
};

/**
 * React's own hooks, closed. `useFormikContext()` can only be written bare, so
 * counting every `use[A-Z]` identifier charges the conforming side with sites
 * where nobody made a choice: on one measured repository the open predicate
 * reads 0.647 and this one 0.004, and only the second answers the claim.
 */
const REACT_HOOKS = new Set([
  "useState", "useEffect", "useContext", "useReducer", "useCallback", "useMemo",
  "useRef", "useImperativeHandle", "useLayoutEffect", "useInsertionEffect",
  "useDebugValue", "useId", "useDeferredValue", "useTransition",
  "useSyncExternalStore", "useOptimistic", "useActionState",
]);

const I18N_MODULE =
  /^(react-intl|react-i18next|i18next|next-intl|react-intl-universal)$|^@(lingui|formatjs)\//;
const TRANS_ELEMENT = /^(FormattedMessage|FormattedHTMLMessage|Trans|Translate)$/;
const TRANS_CALL = /^(t|translate|formatMessage|__|gettext)$/;

// oxc does not decode entities: value, raw and the source slice are all
// " &middot; ", so a bare two-letter test matches the "mi" inside it.
const ENTITY = /&[a-zA-Z0-9#]+;/g;
// Two consecutive letters in any script. [A-Za-z]{2} reads a Cyrillic or Greek
// repository as fully translated, and trim() alone counts every indentation run.
const TWO_LETTERS = /\p{L}\p{L}/u;

const isVisibleText = (raw) =>
  typeof raw === "string" && TWO_LETTERS.test(raw.replace(ENTITY, " "));

const isTransElement = (n) =>
  n &&
  n.type === "JSXElement" &&
  n.openingElement &&
  TRANS_ELEMENT.test(jsxName(n.openingElement) ?? "");

/** A file either ships a translation layer or the claim does not apply to it. */
function usesI18n(program) {
  let found = false;
  walk(program, (n) => {
    if (found) return;
    if (n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" ||
        n.type === "ExportAllDeclaration") {
      const src = n.source && n.source.value;
      if (typeof src === "string" && I18N_MODULE.test(src)) found = true;
      return;
    }
    if (n.type === "JSXOpeningElement" && TRANS_ELEMENT.test(jsxName(n) ?? "")) found = true;
  });
  return found;
}

/** The expression a handler prop was given, or null where it has no container. */
function handlerValue(n) {
  const name = attrName(n);
  if (!name || !HANDLER_PROP.test(name)) return null;
  const v = n.value;
  if (!v || v.type !== "JSXExpressionContainer") return null;
  return v.expression ?? null;
}

export const JSX_DIMENSIONS = [
  {
    key: "hook_call_style",
    claim: "React's hooks are called by their bare name, not through React.",
    counterClaim: "React's hooks are called through React., not by their bare name",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a JSX file calling one of React's own seventeen hooks by name, either bare or through the React namespace. A hook the repository wrote is not one of them",
      blind: null,
    },
    langs: ["jsx"],
    // The reported node is the callee, never the CallExpression:
    // check.mjs fingerprints the whole slice, so reporting the call would put a
    // useEffect body in the fingerprint and any edit inside it would resurface
    // as a newly introduced violation.
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "CallExpression") return;
        const c = n.callee;
        if (!c) return;
        if (c.type === "Identifier" && REACT_HOOKS.has(c.name)) {
          return add({ node: c, conforming: true, where: declName(ctx.fn) });
        }
        // The object has to be React itself. Any other receiver is a library
        // method that happens to share a hook's name, and charging it here
        // would report a namespace choice nobody made.
        if (c.type !== "MemberExpression" || c.computed) return;
        if (!c.object || c.object.type !== "Identifier" || c.object.name !== "React") return;
        if (!c.property || !REACT_HOOKS.has(c.property.name)) return;
        add({ node: c, conforming: false, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "handler_is_named",
    claim: "an event handler prop is given a named function, not an inline arrow",
    counterClaim: "an event handler prop is given an inline arrow, not a named function",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a JSX file passing an event handler prop whose value is a function, a named identifier, or a non-computed member expression. An explicit undefined is not a handler",
      blind: null,
    },
    langs: ["jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "JSXAttribute") return;
        const e = handlerValue(n);
        if (!e) return;
        const where = declName(ctx.fn);
        // A bind call, a ternary and `undefined` are a third form the claim
        // does not name. Counting them as violations reads a repository that
        // hoists every handler as inconsistent and drops it under the ratio gate.
        if (isFunctionLike(e)) {
          return add({ node: n.name, conforming: false, where });
        }
        if (e.type === "Identifier" && e.name !== "undefined") {
          return add({ node: n.name, conforming: true, where });
        }
        if (e.type === "MemberExpression" && !e.computed) {
          add({ node: n.name, conforming: true, where });
        }
      });
    },
  },

  {
    key: "spread_on_component",
    claim: "a prop spread lands on a component, not on a host element",
    counterClaim: null, // the inverse spreads unknown props onto a DOM node
    precision: "precise",
    applicabilityPredicate: {
      sites: "a JSX file spreading props onto an element, counted once per spread attribute rather than once per element",
      blind: null,
    },
    langs: ["jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "JSXOpeningElement") return;
        const component = !isHostElement(n);
        const where = declName(ctx.fn);
        // Per attribute, not per element: `<div {...a} {...b}>` is two sites,
        // and counting one hides a wrapper that spreads twice.
        for (const a of n.attributes || []) {
          if (a && a.type === "JSXSpreadAttribute") {
            add({ node: a, conforming: component, where });
          }
        }
      });
    },
  },

  {
    key: "text_translated",
    claim: "user-visible text goes through the translation layer",
    // Only files that already reach a translation layer are candidates, so the
    // inverse is untranslated text in a repository that translates.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "user-visible text or a translation call inside a JSX file that already reaches a translation layer, so a repository without one produces no sites rather than a directory of zeros",
      blind: "a string handed to a component through a prop is invisible from the element that renders it",
    },
    langs: ["jsx"],
    /**
     * Measured: one repository yields 311 candidates over 45 areas without the
     * translation-layer gate, all non-conforming, and none at all with it.
     *
     * Both dialects count. Element-form-only reads a `useTranslation()`
     * repository as 0 of 14 and states nothing where it measures 229 of 243.
     */
    run(program, add) {
      if (!usesI18n(program)) return;
      walk(program, (n, ctx) => {
        const inTrans = () => ctx.ancestors.some(isTransElement);
        if (n.type === "JSXOpeningElement") {
          if (TRANS_ELEMENT.test(jsxName(n) ?? "")) {
            add({ node: n, conforming: true, where: declName(ctx.fn) });
          }
          return;
        }
        if (n.type === "JSXText") {
          // Text inside a translation element is that element's data: charging
          // every defaultMessage as an untranslated string inverts the claim.
          if (!isVisibleText(n.value) || inTrans()) return;
          add({ node: n, conforming: false, where: declName(ctx.fn) });
          return;
        }
        if (n.type !== "JSXExpressionContainer") return;
        const parent = ctx.ancestors[ctx.ancestors.length - 1];
        // A child, not an attribute value: `values={{ n: t("x") }}` is data.
        if (!parent || (parent.type !== "JSXElement" && parent.type !== "JSXFragment")) return;
        const e = n.expression;
        if (!e || e.type !== "CallExpression") return;
        if (!TRANS_CALL.test(calleeName(e.callee) ?? "")) return;
        if (inTrans()) return;
        add({ node: n, conforming: true, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "handler_memoised",
    claim: "a handler passed to a child is wrapped in useCallback",
    counterClaim: "a handler passed to a child is passed as it is, not wrapped in useCallback",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a JSX file binding a handler and passing it to an element as a handler prop, counting only names this file bound",
      blind: "a handler defined in another file, or bound by destructuring, was decided where the value was created",
    },
    langs: ["jsx"],
    // Counting a received handler would make the number grow with how many a
    // component takes rather than how many it makes.
    run(program, add) {
      // Each binding keeps the function it was made in. Without it the sets are
      // file-wide and a handler is judged by an unrelated binding of the same
      // name in another component.
      const bound = [];
      walk(program, (n, ctx) => {
        if (n.type === "FunctionDeclaration") {
          if (n.id && n.id.name) bound.push({ name: n.id.name, memo: false, scope: ctx.fn });
          return;
        }
        if (n.type !== "VariableDeclarator") return;
        if (!n.id || n.id.type !== "Identifier" || !n.init) return;
        if (n.init.type === "CallExpression" && calleeName(n.init.callee) === "useCallback") {
          bound.push({ name: n.id.name, memo: true, scope: ctx.fn });
        } else if (isFunctionLike(n.init)) {
          bound.push({ name: n.id.name, memo: false, scope: ctx.fn });
        }
      });
      if (bound.length === 0) return;

      walk(program, (n, ctx) => {
        if (n.type !== "JSXAttribute") return;
        const e = handlerValue(n);
        if (!e || e.type !== "Identifier") return;
        const where = declName(ctx.fn);
        // Innermost visible binding wins: module level, or a function this site
        // sits inside. A binding in a sibling component is not visible here.
        const seen = bound.filter(
          (b) => b.name === e.name && (b.scope === null || ctx.ancestors.includes(b.scope))
        );
        const hit = seen.length ? seen[seen.length - 1] : null;
        if (!hit) return;
        if (hit.memo) add({ node: n.name, conforming: true, where });
        else add({ node: n.name, conforming: false, where });
      });
    },
  },
];
