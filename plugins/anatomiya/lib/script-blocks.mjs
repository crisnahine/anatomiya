/**
 * Where the script blocks of a `.vue` or `.svelte` file are.
 *
 * Each scanner follows its compiler's own rules for what a block is and where
 * it ends, and neither reads the JavaScript: both compilers end a body at the
 * first end tag, inside a string too. One pass forward over the file, so a
 * megabyte of markup costs a megabyte.
 *
 * Read by the parser child, so it imports the registry and the blanking, two
 * leaves, and nothing else.
 */
import { blank } from "./blank.mjs";
import { ENGINES, EXTRACTORS } from "./langs.mjs";

// The grammars a block's `lang` may name are the ones the engine that parses it reads.
const LANGS = new Set(ENGINES.oxc.grammars);

const isSpace = (c) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
const endsName = (c) => c === undefined || c === "/" || c === ">" || isSpace(c);
const isLetter = (c) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const opensTag = (source, at, name) =>
  source.startsWith(`<${name}`, at) && endsName(source[at + 1 + name.length]);

// Quote-aware, so a `>` inside `generic="T extends Map<string, number>"` ends
// nothing. Null when the tag never closes.
function openTag(source, lt) {
  let i = lt + 1;
  while (!endsName(source[i])) i++;
  const name = source.slice(lt + 1, i);
  // Lower-cased here, once: left to the loop that holds it against each end
  // tag, the engine builds the string again for every candidate.
  const lower = name.toLowerCase();
  const attrs = new Map();
  for (;;) {
    while (isSpace(source[i])) i++;
    const c = source[i];
    if (c === undefined) return null;
    if (c === ">") return { name, lower, attrs, end: i + 1, selfClosing: false };
    if (c === "/") {
      if (source[i + 1] === ">") return { name, lower, attrs, end: i + 2, selfClosing: true };
      i++;
      continue;
    }
    const from = i++;
    while (source[i] !== "=" && !endsName(source[i])) i++;
    const key = source.slice(from, i);
    while (isSpace(source[i])) i++;
    let value = true;
    if (source[i] === "=") {
      i++;
      while (isSpace(source[i])) i++;
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1);
        if (close === -1) return null;
        value = source.slice(i + 1, close);
        i = close + 1;
      } else {
        const start = i;
        while (source[i] !== undefined && source[i] !== ">" && !isSpace(source[i])) i++;
        value = source.slice(start, i);
      }
    }
    attrs.set(key, value);
  }
}

// Vue's raw text ends at `</name`, then `>` or whitespace, where each character
// is held with its case bit set against the name as the caller hands it: a
// lower-case name ends in any letter case, and one holding an upper-case letter
// or `_` ends nowhere, which takes the rest of the file as the compiler does.
// The name is held against each `</` one character at a time: a name has no
// `/`, so no character is read twice and a long name costs nothing extra.
function rawEnd(source, from, name) {
  for (let at = source.indexOf("</", from); at !== -1; at = source.indexOf("</", at + 2)) {
    let k = 0;
    while (k < name.length && (source.charCodeAt(at + 2 + k) | 0x20) === name.charCodeAt(k)) k++;
    const stop = at + 2 + k;
    const c = source[stop];
    if (k === name.length && (c === ">" || isSpace(c))) {
      const gt = source.indexOf(">", stop);
      return { end: at, after: gt === -1 ? source.length : gt + 1 };
    }
  }
  return null;
}

// Svelte's ends at `</name` as written, optional whitespace, then `>`.
function exactEnd(source, from, name) {
  const tag = `</${name}`;
  for (let at = source.indexOf(tag, from); at !== -1; at = source.indexOf(tag, at + 2)) {
    let i = at + tag.length;
    while (/\s/.test(source[i] ?? "")) i++;
    if (source[i] === ">") return { end: at, after: i + 1 };
  }
  return null;
}

const RAW_IN_TEMPLATE = new Set(["script", "style", "textarea", "title"]);

// Where the markup Vue's tokenizer reads to its own end stops, whatever it
// holds: a comment at `-->`, CDATA at `]]>`, a processing instruction and any
// other `<!` at the first `>`, which is never the character that picked the
// state. -1 where it never ends, and null where `lt` opens none of them.
function passedOver(source, lt) {
  const past = (end, from) => {
    const close = source.indexOf(end, from);
    return close === -1 ? -1 : close + end.length;
  };
  if (source.startsWith("<!--", lt)) return past("-->", lt + 4);
  if (source.startsWith("<![CDATA[", lt)) return past("]]>", lt + 9);
  if (source[lt + 1] === "?") return past(">", lt + 2);
  if (source[lt + 1] === "!") return past(">", lt + (source[lt + 2] === "-" ? 4 : 3));
  return null;
}

// The end of an html `<template>`: nested templates are counted, and comments,
// CDATA, processing instructions, `{{ }}` and the raw text elements are passed over whole.
function templateEnd(source, from) {
  const n = source.length;
  let depth = 1;
  let mustache = -2;
  let i = from;
  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt === -1) return null;
    // Looked up again only once the scan has passed it, or the scan is quadratic.
    if (mustache !== -1 && mustache < i) mustache = source.indexOf("{{", i);
    if (mustache !== -1 && mustache < lt) {
      const close = source.indexOf("}}", mustache + 2);
      if (close === -1) return null;
      i = close + 2;
      continue;
    }
    const passed = passedOver(source, lt);
    if (passed === -1) return null;
    if (passed !== null) {
      i = passed;
      continue;
    }
    if (source[lt + 1] === "/") {
      let j = lt + 2;
      while (!endsName(source[j])) j++;
      const gt = source.indexOf(">", j);
      const after = gt === -1 ? n : gt + 1;
      if (source.slice(lt + 2, j).toLowerCase() === "template" && --depth === 0) {
        return { end: lt, after };
      }
      i = after;
      continue;
    }
    if (!isLetter(source[lt + 1])) {
      i = lt + 1;
      continue;
    }
    const tag = openTag(source, lt);
    if (!tag) return null;
    i = tag.end;
    if (tag.selfClosing) continue;
    if (tag.lower === "template") depth++;
    else if (RAW_IN_TEMPLATE.has(tag.lower)) {
      const close = rawEnd(source, i, tag.lower);
      if (!close) return null;
      i = close.after;
    }
  }
  return null;
}

function vue(source) {
  const n = source.length;
  let setup;
  let plain;
  let unterminated = false;
  let i = 0;
  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt === -1) break;
    const passed = passedOver(source, lt);
    if (passed === -1) break;
    if (passed !== null) {
      i = passed;
      continue;
    }
    if (!isLetter(source[lt + 1])) {
      i = lt + 1;
      continue;
    }
    const tag = openTag(source, lt);
    if (!tag) {
      unterminated = opensTag(source, lt, "script");
      break;
    }
    const lang = tag.attrs.get("lang");
    const html = tag.name === "template" && (!lang || lang === true || lang === "html");
    const close = tag.selfClosing
      ? { end: tag.end, after: tag.end }
      : html
        ? templateEnd(source, tag.end)
        : rawEnd(source, tag.end, tag.name);
    if (!close) {
      unterminated = tag.name === "script";
      break;
    }
    if (tag.name === "script") {
      const block = {
        start: tag.end,
        end: close.end,
        lang: typeof lang === "string" && lang ? lang : "js",
        setup: tag.attrs.has("setup"),
        src: tag.attrs.has("src"),
      };
      // An empty block is no block, so it does not use up its kind's one place.
      if (block.src || source.slice(block.start, block.end).trim() !== "") {
        if (block.setup) setup ??= block;
        else plain ??= block;
      }
    }
    i = close.after;
  }
  // A block with `src` or a lang that is not JavaScript holds its place and is not read.
  const blocks = [setup, plain]
    .filter((b) => b && !b.src && LANGS.has(b.lang))
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, lang }) => ({ start, end, lang }));
  return { blocks, unterminated };
}

function svelte(source) {
  const n = source.length;
  let module;
  let instance;
  let ts;
  let unterminated = false;
  // Whether this line already holds anything a script could be nested in, an
  // indent included: telling a nested script from the component's own takes the
  // parser. Against the compiler on Svelte's own 4,462 test components this
  // misses 1, allowing an indent 5 and no line rule 8; on 3,586 app files, 0.
  let dirty = false;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c !== "<") {
      if (c === "\n") dirty = false;
      else if (c !== "\uFEFF" || i !== 0) dirty = true;
      i++;
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      if (close === -1) break;
      i = close + 3;
      continue;
    }
    const isScript = opensTag(source, i, "script");
    if (!isScript && !opensTag(source, i, "style")) {
      dirty = true;
      i++;
      continue;
    }
    const tag = openTag(source, i);
    if (tag?.selfClosing) {
      i = tag.end;
      continue;
    }
    const close = tag && exactEnd(source, tag.end, tag.name);
    if (!close) {
      unterminated = isScript && !dirty;
      break;
    }
    if (isScript) {
      // One flag for the file, set by the first `<script>` that states a lang.
      const lang = tag.attrs.get("lang");
      if (ts === undefined && typeof lang === "string" && lang) ts = lang === "ts";
      if (!dirty) {
        const block = { start: tag.end, end: close.end };
        if (tag.attrs.has("module") || tag.attrs.get("context") === "module") {
          module ??= block;
        } else instance ??= block;
      }
    }
    i = close.after;
  }
  const blocks = [module, instance]
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .map(({ start, end }) => ({ start, end, lang: ts ? "ts" : "js" }));
  return { blocks, unterminated };
}

const SCANNERS = { vue, svelte };

/** Refuse a scanner table that lacks an extractor a declaration may name, or holds one none may. */
export function assertScanners(scanners, extractors) {
  for (const kind of new Set([...extractors, ...Object.keys(scanners)])) {
    if (!extractors.includes(kind) || !Object.hasOwn(scanners, kind)) throw new Error(`SCANNERS and the registry's extractors disagree on ${kind}`);
  }
}

// Where the module loads, so a declaration never names a scanner that is not here.
assertScanners(SCANNERS, EXTRACTORS);

/**
 * The script blocks a compiler would read, at most two, in file order.
 *
 * `start` and `end` bound the body in the string as given, a BOM counted.
 * `unterminated` says a script the rules accept was opened and never ended,
 * which is a file to reject and not a file with no script.
 */
export function scriptBlocks(source, kind) {
  if (!Object.hasOwn(SCANNERS, kind)) throw new Error(`no script extractor named ${kind}`);
  return SCANNERS[kind](source);
}

/**
 * The source with everything outside `start` to `end` turned to spaces.
 *
 * Same length and same line breaks, so every offset and line a parser reports
 * on the result is the file's own.
 */
export const blankOutside = (source, start, end) =>
  blank(source.slice(0, start)) + source.slice(start, end) + blank(source.slice(end));
