/**
 * Leaf helpers with no imports: a file name's stem words and capability, and a
 * URL path's words and naming class, kept here so the tree-sitter worker reads
 * a route's path without loading oxc.
 */

/**
 * A stem's words: delimiters and camel humps both split, and an acronym stays
 * one word. Splitting before every capital read `HTTPClient` as h,t,t,p,client
 * and `API` as a,p,i, so src/API.ts, APIClient.ts and HTTPClient.ts were not
 * the implementing module and `import API from "./API"` was not a wrapper. A
 * hump is a lower-case letter or digit before a capital, or a capital before a
 * capital that starts a lower-case word (`HTTP|Client`).
 */
export function stemWords(stem) {
  return stem
    .split(/[-_.]/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
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

/**
 * One word's class, or null where the classes cannot disagree about it.
 *
 * A single lowercase word (`index`, `utils`) matches every class at once, so it
 * votes for none of them: counting it as any one class would let a directory
 * full of single words state a convention no filename ever expressed.
 *
 * A word of capitals alone is not PascalCase either. `DEBUG` is the constant
 * `MAX_DEBUG` is with one word fewer, and `GET` is a route handler whose name
 * the framework decides; read as PascalCase, a Next.js `app/api` directory
 * stated "functions are named PascalCase" and a constants module stated it of
 * its exports. It spells the SCREAMING case none of the four classes is, the
 * way `MAX_DEBUG` already does.
 */
/** The four naming classes a word may spell, which is every class `classifyWord` answers; a row that learns one declares this list. */
export const CLASSES = ["camelCase", "PascalCase", "kebab-case", "snake_case"];

export function classifyWord(word) {
  if (/^[\p{Ll}\p{Lo}\d]+(-[\p{Ll}\p{Lo}\d]+)+$/u.test(word)) return "kebab-case";
  if (/^[\p{Ll}\p{Lo}\d]+(_[\p{Ll}\p{Lo}\d]+)+$/u.test(word)) return "snake_case";
  // Every character class here is disjoint from its neighbour, so no run
  // splits two ways: an identifier is repository-controlled input, and the
  // ambiguous `(?:[A-Z][a-zA-Z0-9]*)+` this replaces measured six seconds on
  // twenty-eight characters.
  //
  // Letters by Unicode case, not ASCII range: `caféBar` spelled no class and
  // `café` was not the single lowercase word it is (see `spellsEveryClass`).
  // A letter with no case (`\p{Lo}`, a CJK name) sides with lower case, since
  // it cannot make any two classes disagree.
  if (/^\p{Ll}[\p{L}\d]*$/u.test(word) && /\p{Lu}/u.test(word)) return "camelCase";
  if (/^\p{Lu}[\p{L}\d]*$/u.test(word) && /\p{Ll}/u.test(word)) return "PascalCase";
  return null;
}

/**
 * The words a URL path spells, in order. A parameter (`:id`, `:id?`, `*`,
 * `[id]`, `$id`, `{id}`, `<int:id>`) is the framework's syntax rather than a name anybody
 * chose, and so is a format group (`(.:format)`); a query or a fragment ends
 * the path. A scheme makes it somebody else's URL, and everything under
 * `.well-known` is named by the standard that registers it
 * (`openid-configuration`, `apple-app-site-association`).
 */
export function pathWords(text) {
  return typeof text !== "string" || /^[a-z][a-z\d+.-]*:/i.test(text) || text.startsWith("//") ? null : walkPath(text).words;
}

/** Whether a path reaches `.well-known`, however its segment is spelled around the name. */
export const namesWellKnown = (text) => typeof text === "string" && walkPath(text).wellKnown;

function walkPath(text) {
  const words = [];
  for (const segment of text.split("/")) {
    // An optional group comes off at its own bracket, whichever segment holds it: `posts(/archive_view)`, `(saved_view)`.
    const part = segment.replace(/^\(+/, "");
    if (part === "" || /^[:*[${<]|^\.:/.test(part)) continue;
    const cut = part.search(/[?#]/);
    const word = (cut === -1 ? part : part.slice(0, cut)).replace(/\(.*$/, "").replace(/\)+$/, "");
    if (word === ".well-known") return { words, wellKnown: true };
    if (word) words.push(word);
    if (cut !== -1) break;
  }
  return { words, wellKnown: false };
}

// Two words at least: a separator, or a capital after a lower-case letter.
// `Users` alone is a case, not a choice between kebab-case and snake_case.
const spellsWords = (word) => /[-_]|\p{Ll}\p{Lu}/u.test(word);

/**
 * The words of a path that are sites, each with the class it spells.
 *
 * `mayBeCut` says whatever produced the text may have cut it short, so its
 * last word may be part of one: the Ruby tree keeps `RUBY_STRING_CAP`
 * characters of a string.
 */
export function pathSites(text, { mayBeCut = false } = {}) {
  const words = pathWords(text);
  if (!words) return [];
  const whole = mayBeCut && words.length ? words.slice(0, -1) : words;
  return whole.flatMap((word) => {
    const cls = spellsWords(word) ? classifyWord(word) : null;
    return cls ? [{ word, cls }] : [];
  });
}

/**
 * One site per word of a path that is a site (`pathSites`), each carrying the
 * route declaration it sits in as its section: a route table is one file by
 * design, and each route in it was declared on its own (the reducer's
 * `sectionsOf`). The declaration alone, never a route around it, since a
 * React Router table nests every route under one layout route.
 */
export function addPathSites(add, node, text, section, { mayBeCut = false } = {}) {
  for (const { word, cls } of pathSites(text, { mayBeCut })) {
    add({ node, conforming: false, where: word, class: cls, section });
  }
}
