import { walk, fromVisitor, isFunctionLike, declName, value, boundNames } from "./walk.mjs";

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
 * predicates. A `.js` file whose tree holds JSX speaks `jsx` too
 * (`spokenIn` in `langs.mjs`), so a component written in `.js` is asked
 * these rows and a `.js` helper beside it is not.
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
 * Whether an opening element names a DOM tag rather than a component.
 *
 * Only a bare lowercase identifier is a host tag. A member expression resolves
 * through a binding whatever its last segment is called, so `<Calendar.default/>`
 * is a component; reading the last segment called it a `div`.
 */
function isHostElement(node) {
  const n = node && (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement")
    ? node.name
    : node;
  if (!n) return false;
  if (n.type === "JSXMemberExpression") return false;
  if (n.type === "JSXNamespacedName") return true;
  return n.type === "JSXIdentifier" && HOST.test(n.name ?? "");
}

/**
 * The element's own name. A member element is its LAST segment, so
 * `<Menu.Item/>` is `Item`; reading the object segment misnames `<ns.div/>`.
 * A namespaced element (`<svg:rect/>`) is never a component, so it is null.
 */
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

/** The name being called through `c`, the callee of `f()` or `a.f()`, or null. */
export const calleeName = (c) => {
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
export const REACT_HOOKS = new Set([
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

/** Whether this node shows a translation layer; a file without one is not asked the claim. */
function showsI18n(n) {
  if (n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" ||
      n.type === "ExportAllDeclaration") {
    const src = n.source && n.source.value;
    return typeof src === "string" && I18N_MODULE.test(src);
  }
  return n.type === "JSXOpeningElement" && TRANS_ELEMENT.test(jsxName(n) ?? "");
}

/** The expression a handler prop was given, or null where it has no container. */
function handlerValue(n) {
  const name = attrName(n);
  if (!name || !HANDLER_PROP.test(name)) return null;
  const v = n.value;
  if (!v || v.type !== "JSXExpressionContainer") return null;
  return v.expression ?? null;
}

/**
 * Every name this file names an element by: the root binding, never an
 * attribute and never a namespace's second segment.
 *
 * Exported because three rows outside this file ask the same question: whether
 * a name is read as a value through JSX (`type_only_import`), and whether a
 * function's name is JSX's to decide rather than the area's
 * (`function_naming_case`).
 */
export function jsxElementNames(program) {
  // Asked by three rows of the same file, so walked once per tree.
  const known = ELEMENT_NAMES.get(program);
  if (known) return known;
  const names = new Set();
  walk(program, (n, ctx) => {
    if (n.type !== "JSXIdentifier") return;
    const p = ctx.ancestors[ctx.ancestors.length - 1];
    if (!p) return;
    if (
      p.type === "JSXOpeningElement" ||
      p.type === "JSXClosingElement" ||
      (p.type === "JSXMemberExpression" && p.object === n)
    ) {
      names.add(n.name);
    }
  });
  ELEMENT_NAMES.set(program, names);
  return names;
}

const ELEMENT_NAMES = new WeakMap();

/**
 * A function whose own body yields JSX, which is what a component is.
 *
 * Every value it hands out, not only a bare `return <div/>`: a component that
 * renders through a ternary or an `&&` returns neither an element nor anything
 * `value` peels, and reading only those left it in the naming vote. In a
 * directory of 40 components beside 40 helpers that flipped the learned class
 * to camelCase, and the remedy the check then asked for was a lowercase
 * component name, which is a host element. Four corpus repositories hold 62,
 * 35, 33 and 33 such functions.
 *
 * The value handed out and not the whole body, which is what the sentence says
 * and the direction that costs more to get wrong: a function that builds an
 * element and returns a string made from it hands out no JSX, and asking the
 * body alone dropped ten of those across two measured repositories out of a
 * population the map never announced.
 *
 * A nested function's JSX belongs to that function: `renderRows` returning
 * `items.map((i) => <li/>)` hands out an array, and it is named like a function
 * everywhere it appears.
 */
export function yieldsJsx(fn) {
  if (!fn || !fn.body) return false;
  const handed = fn.body.type === "BlockStatement" ? [] : [fn.body];
  walk(fn.body, (n, c) => {
    if (c.fn || !n.argument) return;
    if (n.type === "ReturnStatement" || n.type === "YieldExpression") handed.push(n.argument);
  });
  return handed.some(isElement);
}

/**
 * Whether a binding's initialiser makes a component without being a function
 * itself: a call handed a function that yields JSX, or a `styled` template.
 *
 * `export const Field = forwardRef((props, ref) => <input />)` is a component
 * exactly as a plain function is, and its initialiser is a call, so the plain
 * rule never saw the function it was handed. Measured on a components directory
 * of 45 plain components and one `forwardRef` field: "exported names are
 * camelCase" 90 of 91 with the field as its exception, and the check asked for
 * a new one to be named `textInput`, which is a host tag.
 *
 * The wrapper is not read by name. `forwardRef`, `memo`, `observer` and every
 * other higher-order component hand back a component made from the one they
 * were given, and `memo(forwardRef(...))` is the ordinary nesting, so calls are
 * descended through to the function they were handed. A call handed a function
 * that yields anything else is the helper it is named as: `create((set) => ({}))`
 * builds a store. `styled` is the one name read, because it is the binding
 * every styled library exports under that name, and what its template or call
 * makes is an element type: `styled.h1`, `styled(Anchor)` and
 * `styled(Anchor).attrs({})` all root there.
 *
 * A wrapper handed a name rather than a function, `forwardRef(ButtonInner)` or
 * `memo(CardImpl)`, is handed the function this file bound under that name at
 * module level, which is read the same way: without it both exports voted as
 * PascalCase values and a helper directory asked for them in camelCase. `lazy`
 * and `dynamic` are the other names read: the function they are handed yields
 * an `import()`, never JSX, so nothing about it shows the component it loads,
 * and `lazy(() => import("./Settings"))` is how React and Next.js spell one.
 */
export function makesComponent(init, program = null) {
  let fns = null;
  const seen = new Set();
  const work = [init];
  while (work.length) {
    let v = value(work.pop());
    if (!v || seen.has(v)) continue;
    seen.add(v);
    if (v.type === "Identifier" && program) {
      fns ??= moduleFunctions(program);
      v = fns.get(v.name);
      if (!v || seen.has(v)) continue;
      seen.add(v);
    }
    if (isFunctionLike(v)) {
      if (yieldsJsx(v)) return true;
      continue;
    }
    if (v.type !== "CallExpression" && v.type !== "TaggedTemplateExpression") continue;
    if (rootsAtStyled(v.type === "CallExpression" ? v.callee : v.tag)) return true;
    if (v.type === "CallExpression" && LAZY.test(calleeName(v.callee) ?? "") && loadsModule(v.arguments[0])) {
      return true;
    }
    if (v.type === "CallExpression") work.push(...v.arguments);
  }
  return false;
}

const LAZY = /^(lazy|dynamic)$/;

const COMPONENT_TYPE = /^(FC|VFC|FunctionComponent|VoidFunctionComponent|ComponentType)$/;

/**
 * Whether a binding is annotated as a React component type, `React.FC` or a
 * bare `FC`. The namespace is not read, so `R.FC` under `import * as R` counts. A component that renders nothing hands out no JSX, and in a file
 * holding none it is rendered only from elsewhere, so the annotation is the one
 * thing in this file that says what it is.
 */
export function typedAsComponent(id) {
  const t = id?.typeAnnotation?.typeAnnotation;
  if (t?.type !== "TSTypeReference") return false;
  const name = t.typeName;
  if (name?.type === "Identifier") return COMPONENT_TYPE.test(name.name);
  return name?.type === "TSQualifiedName" && COMPONENT_TYPE.test(name.right?.name ?? "");
}

// The functions this file binds by name at module level: a declaration, or a
// variable bound to a function, exported or not.
function moduleFunctions(program) {
  const fns = new Map();
  for (const st of program.body || []) {
    const d = st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration" ? st.declaration : st;
    if (!d) continue;
    if (d.type === "FunctionDeclaration" && d.id?.name) fns.set(d.id.name, d);
    if (d.type !== "VariableDeclaration") continue;
    for (const decl of d.declarations || []) {
      if (decl.id?.type === "Identifier" && decl.init && isFunctionLike(value(decl.init))) {
        fns.set(decl.id.name, value(decl.init));
      }
    }
  }
  return fns;
}

// `() => import("./X")`, or a `.then` on it that picks a named export: the
// value handed out roots at a dynamic import through members and calls.
function loadsModule(arg) {
  const fn = value(arg);
  if (!fn || !isFunctionLike(fn) || !fn.body) return false;
  const handed = fn.body.type === "BlockStatement" ? [] : [fn.body];
  walk(fn.body, (n, c) => {
    if (c.fn || !n.argument) return;
    if (n.type === "ReturnStatement") handed.push(n.argument);
  });
  return handed.some((h) => {
    let n = value(h);
    while (n && (n.type === "MemberExpression" || n.type === "CallExpression" || n.type === "AwaitExpression")) {
      n = value(n.type === "MemberExpression" ? n.object : n.type === "CallExpression" ? n.callee : n.argument);
    }
    return n?.type === "ImportExpression";
  });
}

// `styled.h1`, `styled("div")` and `styled(Anchor).attrs({})` reach the one
// binding through members and calls, whichever order they are written in.
function rootsAtStyled(node) {
  let n = value(node);
  while (n && (n.type === "MemberExpression" || n.type === "CallExpression")) {
    n = value(n.type === "MemberExpression" ? n.object : n.callee);
  }
  return n?.type === "Identifier" && n.name === "styled";
}

// The shapes a returned element arrives in, peeled iteratively: a chain of
// ternaries nests one level per operand and a generated file reaches thousands.
function isElement(node) {
  const work = [node];
  while (work.length) {
    const v = value(work.pop());
    if (!v) continue;
    if (v.type === "JSXElement" || v.type === "JSXFragment") return true;
    if (v.type === "ConditionalExpression") work.push(v.consequent, v.alternate);
    else if (v.type === "LogicalExpression") work.push(v.right, ...(v.operator === "&&" ? [] : [v.left]));
    else if (v.type === "SequenceExpression") work.push(v.expressions[v.expressions.length - 1]);
  }
  return false;
}

/**
 * The names this node binds to something the file never wrote out, gathered over
 * every node: a rest element, which is by definition the props nobody named, or
 * a call's return.
 *
 * The destructured form is what covers dnd-kit's `attributes` and `listeners`,
 * which arrive together off one `useSortable()` and which a literal reading of
 * "a name bound to a call's return" would miss.
 */
function noteForwarded(n, names) {
  if (n.type === "RestElement") {
    for (const name of boundNames(n.argument)) names.add(name);
    return;
  }
  if (n.type !== "VariableDeclarator" || !n.init) return;
  if (value(n.init).type !== "CallExpression") return;
  for (const name of boundNames(n.id)) names.add(name);
}

/**
 * Whether this spread's value has no list of prop names behind it in this file.
 *
 * A call is one by construction. A cast is peeled, because it is the same
 * forwarding one wrapper deep. An inline object literal, a local object binding
 * and a whole props parameter all keep their keys visible in the file and stay
 * sites: `{...{ className }}` is `className={className}` and is a free choice.
 * A local helper whose keys really are visible is excluded too, which is the
 * accepted cost of the rule and the safe direction.
 */
function neverWrittenOut(argument, forwarded) {
  const v = value(argument);
  if (!v) return false;
  if (v.type === "CallExpression") return true;
  return v.type === "Identifier" && forwarded.has(v.name);
}

export const JSX_DIMENSIONS = [
  {
    key: "hook_call_style",
    tier: "syntactic",
    claim: "React's hooks are called by their bare name, not through React.",
    // A counter whose other side does not compile is a defect; one that merely
    // pushes against the ecosystem default is a house style. A repository
    // writing every hook as `React.useX` chose that, the escape from the finding
    // is one import line, and the finding names the sentence, so an agent
    // reading it knows what to write.
    counterClaim: "React's hooks are called through React., not by their bare name",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a JSX file calling one of React's own hooks by name, either bare or through the React namespace, matched on the name: a hook outside React's own list is not one of them, whoever wrote it",
      blind: null,
    },
    langs: ["jsx"],
    // The reported node is the callee, never the CallExpression:
    // check.mjs fingerprints the whole slice, so reporting the call would put a
    // useEffect body in the fingerprint and any edit inside it would resurface
    // as a newly introduced violation.
    visitor(program, add) {
      return {
        node(n, ctx) {
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
        },
      };
    },
  },

  {
    key: "handler_is_named",
    tier: "syntactic",
    claim: "an event handler prop is given a named function, not an inline arrow",
    counterClaim: "an event handler prop is given an inline arrow, not a named function",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a JSX file passing an event handler prop whose value is a function, a named identifier, or a non-computed member expression. An explicit undefined is not a handler",
      blind: null,
    },
    langs: ["jsx"],
    visitor(program, add) {
      return {
        node(n, ctx) {
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
        },
      };
    },
  },

  {
    key: "spread_on_component",
    tier: "syntactic",
    claim: "a prop spread lands on a component, not on a host element",
    counterClaim: null, // the inverse spreads unknown props onto a DOM node
    precision: "precise",
    applicabilityPredicate: {
      sites: "a JSX file spreading props onto an element, counted once per spread attribute rather than once per element; a spread onto a host element is not one where its value was never written out in this file, meaning a call or a name bound to a rest element or to a call's return",
      notCounted:
        "a spread onto a host element of a rest binding or a call's return, which has no prop names to write instead",
      blind: null,
    },
    langs: ["jsx"],
    visitor(program, add) {
      const forwarded = new Set();
      const spreads = [];
      return {
        node(n, ctx) {
          noteForwarded(n, forwarded);
          if (n.type !== "JSXOpeningElement") return;
          const component = !isHostElement(n);
          const where = declName(ctx.fn);
          // Per attribute, not per element: `<div {...a} {...b}>` is two sites,
          // and counting one hides a wrapper that spreads twice.
          for (const a of n.attributes || []) {
            if (a && a.type === "JSXSpreadAttribute") spreads.push({ a, component, where });
          }
        },
        // After the walk, because a name can be forwarded below the element
        // that spreads it.
        done() {
          for (const { a, component, where } of spreads) {
            // Something has to reach the DOM. A wrapper forwarding
            // `ComponentPropsWithoutRef<"button">` has no list of names to write
            // out instead, and a prop getter returns an object with a ref
            // callback among its keys that the author cannot enumerate.
            //
            // Asymmetric on purpose: a spread that already landed on a component
            // answered the claim, so it stays a site whatever it spreads.
            if (!component && neverWrittenOut(a.argument, forwarded)) continue;
            add({ node: a, conforming: component, where });
          }
        },
      };
    },
  },

  {
    key: "text_translated",
    tier: "syntactic",
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
    visitor(program, add) {
      // Held until the walk has seen whether the file reaches a translation layer.
      let translates = false;
      const sites = [];
      // A translation element is visited before anything inside it, so with
      // none seen yet nothing is inside one, and a file with no translation
      // layer, which holds none, never scans its ancestors.
      const opened = new Set();
      return {
        node(n, ctx) {
          if (!translates && showsI18n(n)) translates = true;
          if (isTransElement(n)) opened.add(n);
          const inTrans = () => opened.size > 0 && ctx.ancestors.some((a) => opened.has(a));
          if (n.type === "JSXOpeningElement") {
            if (TRANS_ELEMENT.test(jsxName(n) ?? "")) {
              sites.push({ node: n, conforming: true, where: declName(ctx.fn) });
            }
            return;
          }
          if (n.type === "JSXText") {
            // Text inside a translation element is that element's data: charging
            // every defaultMessage as an untranslated string inverts the claim.
            if (!isVisibleText(n.value) || inTrans()) return;
            sites.push({ node: n, conforming: false, where: declName(ctx.fn) });
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
          sites.push({ node: n, conforming: true, where: declName(ctx.fn) });
        },
        done() {
          if (translates) for (const hit of sites) add(hit);
        },
      };
    },
  },

  {
    key: "handler_memoised",
    tier: "syntactic",
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
    visitor(program, add) {
      // Each binding keeps the function it was made in. Without it the sets are
      // file-wide and a handler is judged by an unrelated binding of the same
      // name in another component.
      const bound = [];
      // A handler can be passed above the line that binds it, so each one keeps
      // the nodes above it and is judged after the walk.
      const passed = [];
      return {
        node(n, ctx) {
          if (n.type === "FunctionDeclaration") {
            if (n.id && n.id.name) bound.push({ name: n.id.name, memo: false, scope: ctx.fn });
            return;
          }
          if (n.type === "VariableDeclarator") {
            if (!n.id || n.id.type !== "Identifier" || !n.init) return;
            if (n.init.type === "CallExpression" && calleeName(n.init.callee) === "useCallback") {
              bound.push({ name: n.id.name, memo: true, scope: ctx.fn });
            } else if (isFunctionLike(n.init)) {
              bound.push({ name: n.id.name, memo: false, scope: ctx.fn });
            }
            return;
          }
          if (n.type !== "JSXAttribute") return;
          const e = handlerValue(n);
          if (!e || e.type !== "Identifier") return;
          passed.push({ n, e, where: declName(ctx.fn), ancestors: ctx.ancestors.slice() });
        },
        done() {
          if (bound.length === 0) return;
          for (const { n, e, where, ancestors } of passed) {
            // Innermost visible binding wins: module level, or a function this site
            // sits inside. A binding in a sibling component is not visible here.
            // Innermost by scope depth, not by walk order: a nested component's
            // binding is walked before a same-named one its parent declares further
            // down, and taking the last seen scored the child's useCallback as the
            // parent's plain arrow.
            let hit = null;
            let depth = -2;
            for (const b of bound) {
              if (b.name !== e.name) continue;
              const d = b.scope === null ? -1 : ancestors.indexOf(b.scope);
              if (b.scope !== null && d < 0) continue;
              if (d >= depth) {
                hit = b;
                depth = d;
              }
            }
            if (!hit) continue;
            if (hit.memo) add({ node: n.name, conforming: true, where });
            else add({ node: n.name, conforming: false, where });
          }
        },
      };
    },
  },
];
for (const d of JSX_DIMENSIONS) if (d.visitor) d.run = fromVisitor(d.visitor);
