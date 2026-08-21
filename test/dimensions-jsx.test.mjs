import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";
import { JSX_DIMENSIONS, jsxName, attrName } from "../lib/dimensions-jsx.mjs";
import { ALL_DIMENSIONS, dimensionsFor } from "../lib/dimensions.mjs";
import { applyGates } from "../lib/reduce.mjs";

const dim = (key) => JSX_DIMENSIONS.find((d) => d.key === key);

function hits(key, src) {
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  const out = [];
  dim(key).run(program, (h) => out.push(h));
  return out;
}

// B5: the same in-memory string the parser was handed, never a re-read buffer.
const slice = (src, node) => src.slice(node.start, node.end);
const shape = (src, h) => h.map((x) => [slice(src, x.node), x.conforming]);

// --- hook_call_style ---

const NAMESPACED = `
import * as React from "react";
import { useFormikContext } from "formik";
export const C = () => {
  const { values } = useFormikContext();
  const column = React.useMemo(() => 1, []);
  return <div />;
};
`;

test("a library hook is not a candidate for the React namespace claim, because it can only be written one way", () => {
  // Without the closed list every use[A-Z] identifier counts and this file reads
  // 1 of 2 conforming. On empire-flippers/client the open predicate reports
  // 2362/3650 = 0.647 and the closed one 5/1293 = 0.004: the first is a
  // different question wearing this claim's name, and it hides that the
  // repository reaches every React hook through the namespace.
  const h = hits("hook_call_style", NAMESPACED);
  assert.equal(h.length, 1, "useFormikContext has no namespaced form, so nobody chose there");
  assert.equal(h[0].conforming, false);
  assert.equal(h[0].node.type, "MemberExpression");
  assert.equal(slice(NAMESPACED, h[0].node), "React.useMemo");
});

test("the bare hook form conforms and reports the callee, not the call it heads", () => {
  // check.mjs fingerprints normalise(source.slice(node.start, node.end)) with no
  // truncation, so reporting the CallExpression would put a whole useEffect body
  // in the fingerprint and any edit inside it would resurface as a new violation.
  const src = `import * as React from "react";
export const C = () => {
  const [a, set] = useState(0);
  React.useEffect(() => { set(a + 1); }, [a]);
  return a;
};`;
  const h = hits("hook_call_style", src);
  assert.deepEqual(shape(src, h), [["useState", true], ["React.useEffect", false]]);
  assert.equal(h[0].node.type, "Identifier");
});

test("a file calling no React hook contributes nothing", () => {
  assert.equal(hits("hook_call_style", `export const a = React.createElement("div");`).length, 0);
});

// --- handler_is_named ---

const ATTRS = `const A = () => <a aria-label="x" data-t="y" xlink:href="z" onClick={f} />;`;

test("a hyphenated attribute name arrives as one JSXIdentifier and a namespaced one does not", () => {
  // Verified against oxc: aria-label is JSXIdentifier{name:"aria-label"} and
  // xlink:href is JSXNamespacedName. Reading a.name.name alone returns undefined
  // for the second, so a namespaced attribute either throws inside the dimension
  // (costing every count for that file, per parse-worker's per-dimension catch)
  // or silently drops.
  const { program } = parseSync("f.tsx", ATTRS, { sourceType: "module" });
  const open = program.body[0].declarations[0].init.body;
  const names = open.openingElement.attributes.map(attrName);
  assert.deepEqual(names, ["aria-label", "data-t", "xlink:href", "onClick"]);

  const h = hits("handler_is_named", ATTRS);
  assert.deepEqual(shape(ATTRS, h), [["onClick", true]]);
});

const HANDLERS = `const A = () => (
  <B
    onClick={handleClick}
    onClose={props.onClose}
    onOpen={() => { dismiss(); return true; }}
    onBlur={fn.bind(this)}
    onFocus={busy ? a : b}
    onDrop={undefined}
  />
);`;

test("only a function, an identifier and a member read are handler candidates", () => {
  // The onOpen line is mastodon components/status_action_bar/index.jsx:415, one
  // of its 2 violations in 1,069. Counting the bind call and the ternary as
  // violations reports a repository that hoists every handler as inconsistent:
  // mastodon reads 1067 of 1069 with this predicate, and adding those forms
  // drags it under the 0.90 ratio gate and deletes all five stated directives.
  const h = hits("handler_is_named", HANDLERS);
  assert.deepEqual(shape(HANDLERS, h), [
    ["onClick", true],
    ["onClose", true],
    ["onOpen", false],
  ]);
});

test("a bare prop and a string prop are not handler sites", () => {
  const src = `const A = () => <B disabled id="x" title={label} />;`;
  assert.equal(hits("handler_is_named", src).length, 0, "only /^on[A-Z]/ names a handler");
});

// The fingerprint is normalise(source.slice(node.start, node.end)); check.mjs:437.
const normalise = (s) => s.replace(/\s+/g, " ").trim();

test("a violation's reported node is the attribute name, so an edit inside the arrow body does not re-report it as new", () => {
  // Reporting the JSXAttribute puts the whole arrow body in the fingerprint, so
  // every edit inside a pre-existing inline handler surfaces as a newly
  // introduced violation on the branch that touched it.
  const a = `const A = () => <B onClick={() => save(1)} />;`;
  const b = `const A = () => <B onClick={() => save(2)} />;`;
  const [ha] = hits("handler_is_named", a);
  const [hb] = hits("handler_is_named", b);

  assert.equal(ha.conforming, false);
  assert.equal(ha.node.type, "JSXIdentifier");
  assert.equal(slice(a, ha.node), "onClick");
  assert.equal(
    normalise(slice(a, ha.node)),
    normalise(slice(b, hb.node)),
    "the two fingerprint identically, so the edit is not a new violation"
  );
});

// --- spread_on_component ---

const SPREADS = `const A = () => <div {...a} {...b} />;
const B = () => <Menu.Item {...c} />;`;

test("two spreads on one host element are two violations, and a member-named element is judged by its last segment", () => {
  // Counting one site per element reads 2 candidates and hides one of the two
  // divs, understating the non-conforming side exactly where a wrapper spreads
  // twice; reading a member element off its object segment rather than its
  // property segment misnames <ns.div>. EF measures 2158 of 2176 with the
  // per-attribute shape and GitNexus 0 of 7.
  const h = hits("spread_on_component", SPREADS);
  assert.deepEqual(shape(SPREADS, h), [
    ["{...a}", false],
    ["{...b}", false],
    ["{...c}", true],
  ]);
  for (const x of h) assert.equal(x.node.type, "JSXSpreadAttribute");
});

test("an element name resolves to its last segment, and a namespaced element is never a component", () => {
  const src = `const A = () => <Menu.Item.Label {...a} />;
const B = () => <svg:rect {...b} />;`;
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  const open = (i) => program.body[i].declarations[0].init.body.openingElement;
  assert.equal(jsxName(open(0)), "Label");
  assert.equal(jsxName(open(1)), null, "a namespaced element is not a component");
  assert.deepEqual(hits("spread_on_component", src).map((x) => x.conforming), [true, false]);
});

test("a file holding no spread contributes nothing", () => {
  assert.equal(hits("spread_on_component", `const A = () => <div className="x" />;`).length, 0);
});

// --- text_translated ---

test("a repository with no translation layer produces no candidates, rather than a directory of zeros", () => {
  // Without the applicability gate bulletproof-react produces 311 candidates
  // across 45 areas, every one non-conforming, and every area file gains a line
  // reading "user-visible text goes through the translation layer: no
  // convention. 0 of N sites". Measured on EF: 4,533 candidates over 100 area
  // slots without the gate, 66 over 7 with it.
  const bare = `export const A = () => <p>Save changes</p>;`;
  assert.equal(hits("text_translated", bare).length, 0);

  const imported = `import { FormattedMessage } from "react-intl";
export const A = () => <p>Save changes</p>;`;
  const h = hits("text_translated", imported);
  assert.equal(h.length, 1);
  assert.equal(h[0].conforming, false);
  assert.equal(h[0].node.type, "JSXText");
  assert.equal(slice(imported, h[0].node), "Save changes");
});

test("the call form and the element form are the same convention, and counting only one reads a translating repository as zero", () => {
  // Element-form-only reads GitNexus as 0 of 14 and states nothing there,
  // because GitNexus translates through useTranslation() and {t('key')}; with
  // both dialects it is 229 of 243 and states one area.
  const call = `import { useTranslation } from "react-i18next";
export const A = () => { const { t } = useTranslation(); return <p>{t("a.b")}</p>; };`;
  assert.deepEqual(hits("text_translated", call).map((x) => x.conforming), [true]);

  const element = `import { FormattedMessage } from "react-intl";
export const B = () => <p><FormattedMessage id="a.b" defaultMessage="Hi" /></p>;`;
  assert.deepEqual(hits("text_translated", element).map((x) => x.conforming), [true]);

  // Dropping this rule charges every defaultMessage as an untranslated string
  // and puts mastodon below the ratio gate.
  const inside = `import { Trans } from "react-i18next";
export const C = () => <p><Trans>Hello world</Trans></p>;`;
  assert.deepEqual(
    hits("text_translated", inside).map((x) => x.conforming),
    [true],
    "text inside a translation element is data, not an untranslated string"
  );
});

const MIXED_TEXT = `import { Trans } from "react-i18next";
export const A = () => (
  <p>
    <b>a</b> &middot; {x} <i>Привет мир</i>
  </p>
);`;

test("whitespace, punctuation and a single letter between tags are not user-visible text", () => {
  // [A-Za-z]{2} misses the Cyrillic string, so a Russian-language repository
  // reads as fully translated and states a convention it does not have. A
  // trim() alone counts every indentation run: EF holds 5,333 JSX elements and
  // the raw candidate count would be dominated by whitespace, putting the ratio
  // at the mercy of the formatter. oxc does not decode entities either, so
  // \p{L}\p{L} over the raw run matches the "mi" inside &middot;.
  const h = hits("text_translated", MIXED_TEXT);
  assert.equal(h.length, 1);
  assert.equal(h[0].conforming, false);
  assert.equal(slice(MIXED_TEXT, h[0].node), "Привет мир");
});

// --- handler_memoised ---

const BINDINGS = `import { onSave } from "./elsewhere";
export const A = ({ onCancel }) => {
  const save = useCallback(() => {}, []);
  const reset = () => {};
  return <B onSave={onSave} onCancel={onCancel} onDone={save} onReset={reset} />;
};`;

test("a handler prop naming a value this file never bound is not a candidate", () => {
  // Treating every identifier as a plain function marks the import and the
  // destructured prop as un-memoised, which is a decision made in another file.
  // On mastodon that drags 580 of 585 down and costs the one area the dimension
  // states; it also makes the count grow with how many handlers a component
  // receives rather than how many it creates.
  const h = hits("handler_memoised", BINDINGS);
  assert.deepEqual(shape(BINDINGS, h), [["onDone", true], ["onReset", false]]);
});

test("a handler read off props was decided where the value was created", () => {
  const src = `export const A = (props) => <B onClose={props.onClose} />;`;
  assert.equal(hits("handler_memoised", src).length, 0, "a member read is not a candidate");
});

test("a function declaration is the same unmemoised binding as an arrow const", () => {
  const src = `export const A = () => {
  function reset() {}
  return <B onReset={reset} />;
};`;
  assert.deepEqual(hits("handler_memoised", src).map((x) => x.conforming), [false]);
});

// --- the shape every dimension has to satisfy ---

// A dimension's per-file shape as the reducer leaves it, built from per-file
// candidate counts so a fixture states the distribution it means.
function spread(candidatesPerFile) {
  const candidates = candidatesPerFile.reduce((a, b) => a + b, 0);
  let sumSq = 0;
  let top = { candidates: 0, conforming: 0 };
  for (const n of candidatesPerFile) {
    sumSq += (n / candidates) ** 2;
    if (n > top.candidates) top = { candidates: n, conforming: n };
  }
  return { candidates, conforming: candidates, effectiveFiles: 1 / sumSq, top };
}

test("the JSX dimensions declare jsx alone, so a mixed area measures them against its .tsx files", () => {
  // EF's src holds 1,638 .tsx among 2,356 files. Declaring ["js","jsx"] measures
  // every JSX claim against the .ts files it can never speak about and
  // suppresses all five in every mixed area as narrow predicates, which is
  // silent: the counts still print and only the gate name says why.
  for (const d of JSX_DIMENSIONS) assert.deepEqual(d.langs, ["jsx"], d.key);

  const counts = spread([12, 12, 12, 12, 12]);
  const files = ["a/1.tsx", "a/2.tsx", "a/3.tsx", "b/4.tsx", "b/5.tsx"];
  const ctx = { authors: 3, areaFileCount: 40, areaDirCount: 2 };

  const jsxOnly = applyGates({ applicability: 7, langFileCount: 8, files, ...counts }, ctx);
  assert.equal(jsxOnly.directive, true);
  assert.equal(jsxOnly.gate, null);

  const wholeArea = applyGates({ applicability: 7, langFileCount: 40, files, ...counts }, ctx);
  assert.equal(wholeArea.directive, false, "the floor asks 10 files of 40 and 7 are applicable");
  assert.equal(wholeArea.gate, "applicability");
});

test("the five JSX dimensions ship under the keys and precisions they were measured as", () => {
  // C5: a partial predicate can never reach top severity, so the precision is
  // read by the renderer and is part of the claim, not documentation.
  assert.deepEqual(
    JSX_DIMENSIONS.map((d) => [d.key, d.precision]),
    [
      ["hook_call_style", "precise"],
      ["handler_is_named", "precise"],
      ["spread_on_component", "precise"],
      ["text_translated", "partial"],
      ["handler_memoised", "partial"],
    ]
  );
  for (const d of JSX_DIMENSIONS) {
    assert.ok(d.claim && d.claim.length > 10, `${d.key} needs a readable claim`);
    assert.equal(typeof d.run, "function", d.key);
  }
});

test("every JSX dimension is reachable from the one registry the scan selects with", () => {
  // A dimension defined and not spread into ALL_DIMENSIONS is a file nobody
  // runs, and this file would still pass while the scan counted nothing.
  const all = ALL_DIMENSIONS.map((d) => d.key);
  for (const d of JSX_DIMENSIONS) assert.ok(all.includes(d.key), `${d.key} is not registered`);

  const jsx = dimensionsFor(["jsx"]).map((d) => d.key);
  for (const d of JSX_DIMENSIONS) assert.ok(jsx.includes(d.key), `${d.key} is not selected for jsx`);

  for (const lang of ["js", "ruby"]) {
    const selected = dimensionsFor([lang]).map((d) => d.key);
    for (const d of JSX_DIMENSIONS) {
      assert.ok(!selected.includes(d.key), `${d.key} would run over a ${lang} area`);
    }
  }
});

const EVERY_DIMENSION = `import * as React from "react";
import { useTranslation } from "react-i18next";
export const Panel = ({ items }) => {
  const { t } = useTranslation();
  const save = React.useCallback(() => {}, []);
  const reset = () => {};
  return (
    <div {...rest}>
      <Row {...props} onSave={save} onReset={reset} onClick={() => save()} />
      <p>Save changes</p>
      <span>{t("panel.title")}</span>
    </div>
  );
};`;

test("every JSX hit carries a typed node with offsets into the parsed source", () => {
  // check.mjs slices the parsed source with node.start/node.end and fingerprints
  // on node.type, so a hit missing any of the three reports a violation with no
  // text and an unstable identity.
  const { program } = parseSync("f.tsx", EVERY_DIMENSION, { sourceType: "module" });
  for (const d of JSX_DIMENSIONS) {
    const out = [];
    d.run(program, (h) => out.push(h));
    assert.ok(out.length > 0, `${d.key} matched nothing, so it proves nothing here`);
    for (const h of out) {
      assert.equal(typeof h.conforming, "boolean", d.key);
      assert.ok(h.node && typeof h.node.type === "string", `${d.key} hit carries no node`);
      assert.equal(typeof h.node.start, "number", `${d.key} node has no start offset`);
      assert.equal(typeof h.node.end, "number", `${d.key} node has no end offset`);
      assert.ok(h.where === null || typeof h.where === "string", `${d.key} where`);
      assert.ok(slice(EVERY_DIMENSION, h.node).length > 0, `${d.key} reports an empty span`);
    }
  }
});

test("a program holding no JSX yields no candidates rather than throwing", () => {
  // Every JSX dimension runs over whatever the area routed as jsx, and a .tsx
  // file with no markup in it is ordinary. A dimension that threw here would
  // drop its own key for the file and take its counts with it.
  const { program } = parseSync("f.tsx", `export const a = 1;`, { sourceType: "module" });
  for (const d of JSX_DIMENSIONS) {
    let n = 0;
    d.run(program, () => n++);
    assert.equal(n, 0, d.key);
  }
});

test("an empty program yields no candidates rather than throwing", () => {
  const { program } = parseSync("f.tsx", "", { sourceType: "module" });
  for (const d of JSX_DIMENSIONS) {
    let n = 0;
    d.run(program, () => n++);
    assert.equal(n, 0, d.key);
  }
});

test("a member-expression element is a component, whatever its last segment is named", () => {
  // JSX resolves `<Calendar.default/>` through a binding; only a bare lowercase
  // identifier is a host tag. Reading the last segment called it a `div`, and
  // one real area sat at 49 of 50 and was stopped on evidence because of it.
  const member = hits("spread_on_component", `
    const A = (p) => <Calendar.default {...p} />
    const B = (p) => <UI.panel {...p} />
    const C = (p) => <Ns.Deep.thing {...p} />
  `);
  assert.equal(member.length, 3);
  assert.ok(member.every((h) => h.conforming), "every member-expression element is a component");

  const host = hits("spread_on_component", `const D = (p) => <div {...p} />`);
  assert.deepEqual(host.map((h) => h.conforming), [false], "a bare lowercase tag is still a host element");

  const ns = hits("spread_on_component", `const E = (p) => <svg:rect {...p} />`);
  assert.deepEqual(ns.map((h) => h.conforming), [false], "a namespaced element is never a component");
});

test("a handler is scored against the binding its own component made", () => {
  // The two sets were file-wide, so an unrelated binding of the same name in
  // another component decided the verdict. Eight sites in one real repository
  // were scored that way, one of them off a useCallback 139 lines away.
  const h = hits("handler_memoised", `
    const A = () => {
      const onSave = useCallback(() => {}, [])
      return <Child onSave={onSave} />
    }
    const B = () => {
      const onSave = () => {}
      return <Child onSave={onSave} />
    }
  `);

  assert.equal(h.length, 2, "both components pass a handler they made");
  assert.deepEqual(h.map((x) => x.conforming), [true, false],
    "each is judged by its own binding, not by whichever was seen first");
});

test("a handler that arrived as a prop is nobody's decision here", () => {
  // Counting it makes the number grow with how many handlers a component
  // receives rather than how many it creates.
  const h = hits("handler_memoised", `
    const A = ({ onSave }) => <Child onSave={onSave} />
  `);
  assert.equal(h.length, 0);
});

/* --- something has to reach the DOM (#60) --- */

test("a forwarded rest binding on a host element is not a site, because no list of prop names exists", () => {
  // A wrapper forwarding `ComponentPropsWithoutRef<"button">` has no list of
  // names to write out instead. A rest element is by definition the props
  // nobody named, which is the line.
  const src = `const ForwardButton = ({ children, ...rest }: Props) => <button {...rest}>{children}</button>`;
  assert.deepEqual(hits("spread_on_component", src), []);
});

test("a prop getter and a destructured hook return are the same forwarding", () => {
  // react-dropzone documents getRootProps() and getInputProps() as spread onto
  // a host element, returning objects with a ref callback among them that the
  // author cannot enumerate. dnd-kit's attributes and listeners are the same
  // shape one destructuring away.
  const dropzone = `const D = () => { const { getRootProps, getInputProps } = useDropzone();
    return <div {...getRootProps()}><input {...getInputProps()} /></div> }`;
  const sortable = `const S = () => { const { attributes, listeners } = useSortable({ id });
    return <div {...attributes} {...listeners} /> }`;

  assert.deepEqual(hits("spread_on_component", dropzone), []);
  assert.deepEqual(hits("spread_on_component", sortable), []);
});

test("a cast is peeled, because it is the same forwarding one wrapper deep", () => {
  assert.deepEqual(hits("spread_on_component", `const A = ({ ...rest }) => <div {...(rest as any)} />`), []);
});

test("what the author could have written out stays a site", () => {
  // `{...{ className }}` is `className={className}` and is a free choice. A
  // local object binding and a whole props parameter both have their keys
  // visible in the file.
  for (const src of [
    `const A = () => <div {...{ className }} />`,
    `const A = () => { const o = { className: "x" }; return <div {...o} /> }`,
    `const A = (props: P) => <div {...props} />`,
  ]) {
    const h = hits("spread_on_component", src);
    assert.equal(h.length, 1, src);
    assert.equal(h[0].conforming, false, src);
  }
});

test("a spread that already landed on a component stays a site whatever it spreads", () => {
  // Asymmetric on purpose: that spread answered the claim.
  const src = `const A = ({ ...rest }) => <Button {...rest} {...useThing()} />`;
  const h = hits("spread_on_component", src);

  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => x.conforming), [true, true]);
});

/* --- the two questions a row outside this file asks about JSX --- */

test("jsxElementNames names the binding an element resolves through, and nothing else", async () => {
  const { jsxElementNames } = await import("../lib/dimensions-jsx.mjs");
  const { program } = parseSync("f.tsx", `
    const A = () => <Button className="x" />
    const B = () => <Menu.Item />
    const C = () => <Box>hi</Box>
    const D = () => <div id="y" />
  `, { sourceType: "module" });

  assert.deepEqual([...jsxElementNames(program)].sort(), ["Box", "Button", "Menu", "div"]);
});

test("yieldsJsx asks whether this function's own body yields an element", async () => {
  const { yieldsJsx } = await import("../lib/dimensions-jsx.mjs");
  const fnOf = (src) => {
    const { program } = parseSync("f.tsx", src, { sourceType: "module" });
    const d = program.body[0];
    return d.type === "FunctionDeclaration" ? d : d.declarations[0].init;
  };

  assert.equal(yieldsJsx(fnOf(`const A = () => <div />`)), true, "an expression body");
  assert.equal(yieldsJsx(fnOf(`function A() { if (x) return null; return <div /> }`)), true, "a guarded return");
  assert.equal(yieldsJsx(fnOf(`const A = () => <></>`)), true, "a fragment");
  assert.equal(yieldsJsx(fnOf(`function A() { return 1 }`)), false);
  assert.equal(
    yieldsJsx(fnOf(`function A() { const inner = () => <div />; return inner }`)),
    false,
    "a return inside a nested function belongs to that function"
  );
  assert.equal(yieldsJsx(null), false);
});

test("a component that renders conditionally is still a component", async () => {
  // Only a bare `return <div/>` was seen, so a ternary or an `&&` left the
  // component in the naming vote. In a directory of 40 components beside 40
  // helpers that flipped the learned class to camelCase and the check then
  // asked for `<auditBadge/>`, a host element: the impossible ask this
  // exclusion exists to prevent. Counted on the corpus: 62, 35, 33 and 33
  // module-level PascalCase functions on four repositories read this way.
  const { yieldsJsx } = await import("../lib/dimensions-jsx.mjs");
  const fnOf = (src) => {
    const { program } = parseSync("f.tsx", src, { sourceType: "module" });
    const d = program.body[0];
    return d.type === "FunctionDeclaration" ? d : d.declarations[0].init;
  };

  assert.equal(yieldsJsx(fnOf(`function A() { return on ? <div /> : null }`)), true, "a ternary");
  assert.equal(yieldsJsx(fnOf(`function A() { return on && <div /> }`)), true, "a guard");
  assert.equal(yieldsJsx(fnOf(`const A = () => on ? <div /> : <span />`)), true, "a ternary expression body");
  assert.equal(yieldsJsx(fnOf(`function* A() { yield <div /> }`)), true, "a yield hands it out too");
  assert.equal(
    yieldsJsx(fnOf(`function renderRows() { return items.map((i) => <li key={i} />) }`)),
    false,
    "the element is the nested arrow's, and a render helper is named like a function"
  );
});

test("a function that builds an element and hands out something else is still a site", async () => {
  const { yieldsJsx } = await import("../lib/dimensions-jsx.mjs");
  // The under-count direction, which the applicability contract calls the
  // dangerous one: the sentence says a function whose body yields JSX, and
  // these three do not. Ten such functions across two measured repositories.
  const fnOf = (src) => {
    const { program } = parseSync("f.tsx", src, { sourceType: "module" });
    const d = program.body[0];
    return d.type === "FunctionDeclaration" ? d : d.declarations[0].init;
  };

  assert.equal(yieldsJsx(fnOf(`function fetchData() { const unused = <div />; return fetch('/x') }`)), false);
  assert.equal(yieldsJsx(fnOf(`function assertThing(x) { if (!x) throw new Error(String(<div />)) }`)), false);
  assert.equal(
    yieldsJsx(fnOf(`const buildPayload = (m) => ({ text: 'a', html: renderToStaticMarkup(<div>{m}</div>) })`)),
    false
  );
});

test("both naming rows leave a component out of their vote, not just one", async () => {
  // `function_naming_case` excluded components and `exported_symbol_case` did
  // not, so the same declaration still drew "exported names are camelCase" and
  // the remedy it named was a lowercase component, a host tag.
  const { NAMING_AST } = await import("../lib/dimensions-naming.mjs");
  const classesOf = (key, src) => {
    const row = NAMING_AST.find((d) => d.key === key);
    const { program } = parseSync("f.tsx", src, { sourceType: "module" });
    const out = [];
    row.run(program, (h) => out.push(h.class));
    return out;
  };
  const sources = [
    `export const UserCard = ({ n }) => (n ? <div>{n}</div> : null)`,
    `export function UserCard() { return <div /> }`,
    `export default function UserCard() { return <div /> }`,
  ];

  for (const src of sources) {
    assert.deepEqual(classesOf("exported_symbol_case", src), [], src);
    assert.deepEqual(classesOf("function_naming_case", src), [], src);
  }

  assert.deepEqual(classesOf("exported_symbol_case", `export const formatDate = (d) => String(d)`), ["camelCase"]);
  assert.deepEqual(classesOf("exported_symbol_case", `export function helperThing() { return 1 }`), ["camelCase"]);
});

test("the naming row leaves a conditional component out of its vote", async () => {
  const { NAMING_AST } = await import("../lib/dimensions-naming.mjs");
  const row = NAMING_AST.find((d) => d.key === "function_naming_case");
  const classesOf = (src) => {
    const { program } = parseSync("f.tsx", src, { sourceType: "module" });
    const out = [];
    row.run(program, (h) => out.push(h.class));
    return out;
  };

  assert.deepEqual(classesOf(`export function CardBox() { return <div /> }`), []);
  assert.deepEqual(classesOf(`export function CardBox() { return a ? <div /> : null }`), []);
  assert.deepEqual(classesOf(`export function CardBox() { return a && <div /> }`), []);
  assert.deepEqual(classesOf(`export function formatDate(d) { return String(d) }`), ["camelCase"]);
});
