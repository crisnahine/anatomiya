/**
 * The top-level keys of a Markdown file's YAML frontmatter, as scalars: plain,
 * quoted, or block.
 *
 * The plugin carries no dependencies, so this reads the part of YAML an agent
 * or skill file uses to say what it is and what effort it runs at. Nested
 * mappings come back as flattened text, and nothing here reads them.
 */
import { readIfFile } from "./hook-io.mjs";

/** The keys and their values, the head as written, and the body after it, or null for a file with none. */
export function frontmatter(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const found = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!found) return null;
  const lines = found[1].split(/\r?\n/);
  const fields = {};
  for (let at = 0; at < lines.length; at++) {
    const pair = keyLine(lines[at]);
    if (!pair) continue;
    const more = [];
    while (at + 1 < lines.length && (/^[ \t]/.test(lines[at + 1]) || (lines[at + 1].trim() === "" && /^[ \t]/.test(lines[at + 2] ?? "")))) {
      more.push(lines[++at]);
    }
    fields[pair.key] = scalar(pair.value.trim(), more.map((line) => line.trim()));
  }
  return { fields, head: found[1], body: source.slice(found[0].length) };
}

/**
 * The top-level key a head line names and the value written after it, or null.
 *
 * The build reads the head with a YAML parser, which takes a quoted key or one
 * with blanks before its colon as the same key as the bare spelling.
 */
export function keyLine(line) {
  const pair = /^(?:([A-Za-z][\w-]*)|"([A-Za-z][\w-]*)"|'([A-Za-z][\w-]*)')[ \t]*:(?:[ \t]+(.*))?$/.exec(line);
  return pair && { key: pair[1] ?? pair[2] ?? pair[3], value: pair[4] ?? "" };
}

/** A key's value, or null where the head names that key more than once, since which one a reader takes is not said anywhere. */
export function onceNamed(fm, key) {
  // A `key:` with no blank after it is no key to YAML, and counting it anyway keeps a doubtful head doubtful.
  return fm.head.split(/\r?\n/).filter((line) => line.startsWith(`${key}:`) || keyLine(line)?.key === key).length > 1 ? null : fm.fields[key];
}

/** A file's frontmatter, or null for a file that cannot be read or has none. */
export function readFrontmatter(path) {
  const text = readIfFile(path);
  return text === "" ? null : frontmatter(text);
}

function scalar(value, more) {
  if (/^[|>][+-]?\d*$/.test(value)) return (value[0] === "|" ? more.join("\n") : more.filter(Boolean).join(" ")).trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    // A line break inside a quoted scalar folds to a space.
    const joined = [value, ...more].join(" ");
    // Ends at the first quote that closes it, so a comment after it holding that quote stays out.
    const closed = (quote === "'" ? /^'(?:[^']|'')*'/ : /^"(?:[^"\\]|\\.)*"/).exec(joined);
    const inner = closed ? closed[0].slice(1, -1) : joined.slice(1);
    if (quote === "'") return inner.replace(/''/g, "'");
    // YAML's double-quoted escapes include all of JSON's, so JSON reads the common ones exactly.
    try {
      return JSON.parse(`"${inner}"`);
    } catch {
      return inner.replace(/\\(["\\])/g, "$1");
    }
  }
  return [value, ...more].filter(Boolean).join(" ").replace(/(^|\s)#.*$/, "").trim();
}
