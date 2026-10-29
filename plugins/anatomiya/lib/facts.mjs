/**
 * The machine record of every slot, and the one place its shape is known.
 *
 * The map is derivable from this file and the check reads it rather than the
 * rendered map, so writer and reader have to agree about the shape. They used to
 * agree by coincidence: the version lived in the writer, the rule for reading an
 * older record was copied into two modules, and the reader never looked at the
 * version at all.
 */
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { outsideClaude, readHead, REFRESH_STATE, resolveInside } from "./rules.mjs";
import { encodePath } from "./encode.mjs";
import { READ_MOST, putBack, recordBytes, writeTemp } from "./store.mjs";
import { slotRecord } from "./slot.mjs";

export const FACTS_PATH = ".claude/anatomiya/facts.json";

// The record's `layout` on its own, written with it by the same writer: the
// hooks read only the layout, and need not parse a record of megabytes for it.
export const LAYOUT_PATH = ".claude/anatomiya/layout.json";

// 2 added the polarity fields. A reader of the older shape sees no `states` and
// falls back to `directive`, which is the claim side and is what every schema-1
// record meant. 3 replaced the single `glob` with the `globs` an area delivers
// on. 4 stores each of those in the two halves it is composed from, `dir` and
// `tail`, rather than joined: the join is a grammar, and a second reading of it
// is a second thing to keep in step. Nothing reads the globs back out of this
// record, so the older joined form needs no rule here. 5 adds `langFileCount`,
// the files a dimension could speak about in this pass: it was computed, shaped
// the applicability gate, and was dropped before the record was written, so the
// share that separates a narrow predicate from a rare construct could not be
// audited from disk. This is the current pass's count, which is the one the
// stored `applicability` is also taken over, so the two divide. On a pinned
// repository the gate itself reads the baseline's. An older record carries no
// such field and reads as absent rather than as zero. 6 adds the three numbers
// the rendered map prints that the record could not reproduce: the count behind
// "and N more" on each side, and the namesake count an obligation renders. The
// bump is the point of versioning at all: two records both saying 5 with
// different shapes is the coincidence this module exists to replace. A version
// this reader has not heard of is refused. 7 is `langFileCount` again, with the
// same name and a narrower meaning: a file whose Flow types were blanked so it
// could be parsed is no longer counted in the denominator of the dimensions
// whose question is the annotation, because it holds no answer for them. A
// schema-6 record from a repository holding Flow divides a current
// `applicability` by an inflated count and reports a share nobody measured.
// 8 adds the semantic tier's own state: whether it ran, whether it ran
// degraded, and the share of type lookups that resolved. A record written
// without it is a scan that did not run the checker, so an absent key reads as
// "did not run" rather than as a missing field.
// 9 stores `tier` on each dimension. The check decides whether to warn about
// unmeasured type-checked claims from it, and a schema-8 record carries no such
// claim to warn about, so an older record reading as none is the truth rather
// than a gap.
// 10 adds two fields that arrive together. `matchesDefault` marks a stated
// slot whose side the model writes unprompted: the renderer drops it to a
// counts line while the check enforces it unchanged, and it is stored only when
// true, so a schema-9 record reads as never matching, which is what its scan
// decided. `learned` is the class a learned-class dimension settled on, stored
// so the record can reproduce the rendered sentence and so the gates can see
// the class move between the pin and today.
// 11 adds the roster: `layout` at the top and `kinds` on each area, the counts
// behind which kinds of file this repository holds and where, and beside them
// `imports` and `reused`, what an area's files import most and what the rest of
// the repository imports out of it. All four read back as null on an older
// record rather than as an empty roster, because an empty one is a repository
// with nothing in it and an absent one is a scan that never counted. The
// sibling pair carries a second null of its own: an area with no static import
// surface at all was never asked either question.
// 12 stores `parse.engines`: which engine read this repository, and the version
// of it that answered. A record written before it reads back as null rather
// than as an empty probe, because a scan that never asked and a machine with no
// parser on it are different facts and a `{}` would say the second.
// 13 stores `corpus.otherExts`: every tracked file this scan has no language
// for, by extension. The overview names those languages so a reader of a
// repository that is half Java or half Rust learns none of it was read, and
// the roster cannot be counted back off for the number, since it prints a
// root's top two extensions and folds the rest away. A record written before
// it falls back to the roster and undercounts, which is what silence did.
// 14 adds what the rest of the repository says about a dimension, leaving this
// area out: `priorBound` beside `bound` on each side, and `borrowed` on the
// side the gates cleared on that prior rather than on this area's own sample.
// The evidence gate needs about 35 perfect sites to reach 0.90 and a measured
// front end's median area holds 11 files, so a perfectly consistent directory
// could never speak; the prior is what lets it, and the two fields are how a
// reader tells a claim this area earned from one it borrowed. An older record
// carries neither and reads as never borrowing, which is what its scan decided.
// 15 stores `learnedKind` on a row that narrows its population to one kind of
// file. A directory of components and a directory of helpers hold different
// naming conventions, and pooled they made every correctly camelCase helper a
// violation of a convention nobody holds. The check has to enforce over the
// same population the map measured, so the kind travels with the class. Absent
// on an older record means the row narrowed nothing, which is what its scan did.
// 16 adds `narrowed`, which says whether the sentence names that kind, so the
// check quotes the sentence the map printed rather than the plain template.
// 17 adds `declined`, the sites a corpus row's classifier held no vote for.
// The counts line prints it and the check reads no such field, so a record
// without it renders a line that discloses nothing. Absent means none, which is
// what every scan before this measured and printed.
// 18 does two things the roster and the gates each needed a field for. The
// fold line's `more` keeps the folded directories' files apart from the files
// under no directory at all and from the files at the repository root, because
// one sentence carried all three and the noun in it named the first: a folded
// root holding 3 files was printed as holding 21. And `authors` reaches the
// record at all, carrying `shallow`: `git log` answers on a truncated clone and
// its answer is true about a window nobody chose, so a `--depth=1` checkout
// read as a one-author repository. A record written before it carries the
// summed count, which is what it printed, and says nothing about its clone,
// which is what its scan knew.
// 19 stores `counterAuthors`. A slot shown on its counter side printed the
// claim side's author count, because the record carried no other, and a held
// area re-renders from the record. An older record prints what it printed.
// `targets` shares 19: the filenames a scan left in the Cursor and Copilot
// directories sit under a key no older reader looks at, and no field moved. A
// number of its own would have every build already installed refuse the record
// and enforce nothing from it. An older record owns nothing there, as does one
// with no key.
// `semantic.carried`, `measuredAt` and `measuredUnder` share 19 for the same
// reason: when the tier's verdict was measured, under which stamp of what the
// checker reads, and whether this scan carried it in place of a run. No older
// reader looks at them, and a record without them was measured under no stamp,
// so the next refresh measures.
// `semantic.failures` shares 19 too: how many runs in a row the checker has
// failed under that stamp, which a refresh carries the failure from at two. A
// record without it counts none.
// `removing` shares 19 as well: the names a scan is about to remove in each
// directory, which a scan killed before it removed them leaves for the next one.
// An older reader ignores the key, and a record without it removes nothing more.
export const FACTS_SCHEMA = 19;

/**
 * Why a parsed record cannot be read, or null.
 *
 * One copy of the rule, because every reader has to refuse the same shapes: a
 * record read against a schema it was not written for enforces a convention
 * nobody stated, which is the one failure the counted-claim model exists to
 * avoid. Absent means 1, since the version arrived with the second shape.
 */
export function schemaProblem(parsed) {
  if (!parsed || !Array.isArray(parsed.areas)) return { kind: "not-a-record", why: "it is not a facts record" };
  const schema = parsed.schema === undefined ? 1 : parsed.schema;
  if (!Number.isInteger(schema) || schema < 1 || schema > FACTS_SCHEMA) {
    return {
      kind: "unknown-schema",
      why: `it is schema ${JSON.stringify(parsed.schema)} and this build reads 1 to ${FACTS_SCHEMA}`,
    };
  }
  return null;
}

/**
 * The most of a record any command reads. One past it is never parsed: a
 * check says so and enforces nothing, and a scan replaces it unread.
 *
 * Not `HEAD_BYTES`, which sizes a rule file: the record is the whole count of a
 * repository, measured at 10,217,406 bytes on microsoft/vscode. A megabyte
 * would have gone silent on exactly the repositories where a directory nobody
 * read is easiest to miss. The cap is there for the shape a rule file cap is
 * there for, a path holding something nobody wrote, and only such a file ever
 * pays it. Equal to `READ_MOST` in `store.mjs`, so the bytes a scan reads to put
 * a record back are bytes a command reads of it.
 */
const RECORD_MOST = READ_MOST;

/**
 * A JSON record this tool wrote, parsed, or `record: null` for anything else at
 * the path, with `oversize` set where a regular file ran past the cap.
 *
 * Through `readHead` rather than a plain read, which waits for ever on a fifo
 * and takes whatever size it finds, and every scan, check and hook reads one.
 */
export function readRecord(path) {
  const entry = readHead(path, RECORD_MOST, { whole: true });
  if (entry.kind !== "file") return { record: null, oversize: false };
  if (entry.size > RECORD_MOST) return { record: null, oversize: true };
  try {
    return { record: JSON.parse(entry.head), oversize: false };
  } catch {
    return { record: null, oversize: false };
  }
}

/**
 * The facts on disk, or why they could not be used.
 *
 * A version past this reader's is refused rather than read: fields move between
 * versions, and a record read against the wrong shape enforces a convention
 * nobody stated. Absent stays `null`, which is the ordinary case of a repository
 * nobody has scanned. A file there that does not parse is a map nothing could
 * use, a committed one that conflicted on a merge, and is said as one.
 */
export function readFacts(root) {
  // The same containment the write side carries. This record drives every
  // enforced claim, every area assignment and every severity in the check, so
  // reading it through a link out of the repository lets a directory the
  // repository does not own decide what the branch is judged against.
  //
  // The leaf too, not only its directory: `atomic` replaces a link there as an
  // entry, but a read follows it, and a committed
  // `.claude/anatomiya/facts.json -> /elsewhere/facts.json` handed the check
  // another directory's areas.
  const dir = resolveInside(root, dirname(FACTS_PATH));
  const path = dir === null ? null : resolveInside(root, FACTS_PATH);
  if (path === null) {
    const which = dir === null ? dirname(FACTS_PATH) : FACTS_PATH;
    return { facts: null, unreadable: `${outsideClaude(which)}, so no map was read from it` };
  }
  const { record: parsed, oversize } = readRecord(path);
  if (oversize) {
    return { facts: null, unreadable: `the map on disk is past the ${RECORD_MOST / 2 ** 20} MiB this reads, so nothing was enforced from it` };
  }
  if (parsed === null) {
    const kind = readHead(path, 0).kind;
    if (kind === "unreadable" && existsSync(path)) {
      return { facts: null, unreadable: "the map on disk could not be opened, so nothing was enforced from it" };
    }
    if (kind !== "file") return { facts: null, unreadable: null };
    return { facts: null, unreadable: "the map on disk does not parse as JSON, so nothing was enforced from it: scan again" };
  }
  // A shape that is not a record at all is the ordinary case of a repository
  // nobody has scanned; a version this build has not heard of is not, and says
  // so. Both decided by the one rule every reader shares.
  const problem = schemaProblem(parsed);
  if (problem?.kind === "not-a-record") return { facts: null, unreadable: null };
  if (problem) {
    return {
      facts: null,
      unreadable: `the map on disk could not be read because ${problem.why}, so nothing was enforced from it: scan again with this build`,
    };
  }
  return { facts: withOlderFields(parsed), unreadable: null };
}

/**
 * The fields a record older than this build carries, which is not at all.
 *
 * Filled in here rather than at each reader, so nothing downstream has to know
 * which version a field arrived in: the roster at schema 11, the engines that
 * answered at 12.
 */
function withOlderFields(parsed) {
  return {
    ...parsed,
    // What history said, absent before 18, which is a scan that never asked.
    authors: parsed.authors ?? null,
    layout: parsed.layout
      ? {
          ...parsed.layout,
          // The three populations were one summed count before 18, and the
          // renderer reads a null floor as that record's own spelling. Filled
          // rather than left absent, so a hand-edited record with no `more` at
          // all reads as nothing folded instead of taking the renderer down.
          more: { roots: 0, files: 0, ...parsed.layout.more, floor: parsed.layout.more?.floor ?? null },
        }
      : null,
    // Left alone where a hand-edited record carries no parse section at all,
    // which is a record to report rather than one to fill in.
    ...(parsed.parse ? { parse: { ...parsed.parse, engines: parsed.parse.engines ?? null } } : {}),
    // The array is checked and its entries are not, so an entry a hand edit
    // broke must not take the reader down.
    areas: parsed.areas.map((a) =>
      a ? { ...a, kinds: a.kinds ?? null, imports: a.imports ?? null, reused: a.reused ?? null } : a
    ),
  };
}

/**
 * The record, and the one definition of what a dimension looks like on disk.
 *
 * A schema bump is this module and its round trip, rather than an edit in every
 * reader with no way to tell which one was missed.
 */
export function writeFacts(root, result) {
  // Resolved rather than joined. `join` normalises `..` and follows no
  // link, so a tracked `.claude -> ../victim` put this record in a directory
  // the repository does not own, beside the map it is the record of.
  const dir = resolveInside(root, dirname(FACTS_PATH));
  if (dir === null) {
    throw new Error(`${outsideClaude(dirname(FACTS_PATH))}, so the facts were not written`);
  }
  mkdirSync(dir, { recursive: true });
  // The record is renamed before its layout file, so a throw at the second
  // rename has already replaced it. Put back the way the map's own write does.
  const record = join(dir, basename(FACTS_PATH));
  const previous = recordBytes(record);
  const was = previous ? readLayout(root, record) : null;
  try {
    writePair(dir, factsJson(result), result.layout);
  } catch (err) {
    const now = recordBytes(record);
    // Only where the failed write replaced what was there: still the same bytes
    // leaves nothing to put back, and `putBackRecord` leaves a record it could
    // not read.
    if (previous === null ? now !== null : !(now && previous?.equals(now))) {
      try {
        putBackRecord(record, previous, was);
      } catch {}
    }
    throw err;
  }
}

/**
 * The record's `previous` bytes back at `path`, as `putBack` in `store.mjs` puts
 * any file back, except that where `was` is the layout file that answered for
 * it, the pair is written again so the restored record has one.
 */
export function putBackRecord(path, previous, was) {
  if (previous === undefined || previous === null || was === null) putBack(path, previous);
  else writePair(dirname(path), previous, was.layout, was.schema);
}

/** The line a scan gives a record past the bound, which it replaces without reading. */
export const oversizedSentence = ({ at, size }, dryRun) =>
  `${encodePath(at)} ${dryRun ? "is" : "was"} ${size} bytes, past the ${RECORD_MOST / 2 ** 20} MiB any command reads of a record, so it ${dryRun ? "would be" : "was"} replaced without being read`;

/**
 * The record's bytes and the layout file stamped from them, both written whole
 * before either is renamed, so a failure up to the record's rename replaces
 * nothing. The record goes first because that rename is the one that can fail
 * with nothing moved: the old pair stays whole and still answers.
 */
export function writePair(dir, bytes, layout, schema) {
  const record = join(dir, basename(FACTS_PATH));
  const temps = [writeTemp(record, bytes)];
  try {
    temps.push(writeTemp(join(dir, basename(LAYOUT_PATH)), stampedLayout(layout, temps[0], schema)));
    renameSync(temps[0], record);
    renameSync(temps[1], join(dir, basename(LAYOUT_PATH)));
  } catch (err) {
    for (const tmp of temps) {
      try {
        unlinkSync(tmp);
      } catch {}
    }
    throw err;
  }
}

/**
 * The record's bytes, for a writer that puts them on disk together with the map.
 * `targets` is the filenames that writer leaves in each directory besides
 * Claude Code's, and `removing` the ones it is about to remove, by target.
 */
export function factsJson(result, targets = {}, removing = {}) {
  return JSON.stringify(factsRecord(result, targets, removing), null, 2) + "\n";
}

/**
 * The layout file's bytes, under the record's schema, stamped with the size and
 * mtime of the record's temporary file. The rename keeps both, and a stat after
 * the rename could stamp another writer's record. A rollback passes the schema
 * the old layout file had, since the record it puts back was written under that.
 */
export function stampedLayout(layout, recordTemp, schema = FACTS_SCHEMA) {
  const { size, mtimeMs } = statSync(recordTemp);
  return JSON.stringify({ schema, record: { size, mtimeMs }, layout: layout ?? null }, null, 2) + "\n";
}

/**
 * The layout the record beside it holds, as `{ layout, schema }`, or null where the
 * layout file cannot answer for that record and the record has to be read.
 *
 * Refused under the record's own schema rule, and unless the record on disk is
 * the very file it was stamped from, to the byte count and the millisecond. An
 * older build rewriting only the record, a checkout or a restore that changes it
 * and keeps old mtimes, a conflict marker or a hand edit all leave a layout file
 * describing some other record. Refused too past the size the reader takes, since
 * the record then reads as nothing. `facts` is the record's path, for a caller
 * that has already resolved it.
 */
export function readLayout(root, facts = resolveInside(root, FACTS_PATH)) {
  // The record first: most directories a hook asks about hold none.
  const record = facts === null ? null : statOf(facts);
  if (record === null || record.size > RECORD_MOST) return null;
  const path = resolveInside(root, LAYOUT_PATH);
  if (path === null) return null;
  const parsed = readRecord(path).record;
  const schema = parsed?.schema;
  if (!Number.isInteger(schema) || schema < 1 || schema > FACTS_SCHEMA) return null;
  if (parsed.record?.size !== record.size || parsed.record?.mtimeMs !== record.mtimeMs) return null;
  return { layout: parsed.layout ?? null, schema };
}

// Null for anything a stat refuses: this runs inside a hook, which never throws.
function statOf(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function factsRecord(result, targets = {}, removing = {}) {
  const named = Object.entries(targets).filter(([, names]) => names.length > 0);
  const going = Object.entries(removing).filter(([, names]) => names.length > 0);
  return {
    schema: FACTS_SCHEMA,
    root: result.root,
    scannedAt: result.scannedAt,
    corpus: result.corpus,
    parse: result.parse,
    // Absent on an older record. Read back as "did not run" rather than as
    // missing; a scan that left the checker off says why in `reason`.
    semantic: result.semantic ?? { ran: false, status: null, reason: null, typedResolutionRate: null },
    suppressAll: result.suppressAll,
    // What history said, and how much of it there was. The gates read it and
    // nothing on disk held it, so no reader could ask why a claim printed as a
    // count. Absent on an older record, which is a scan that never asked.
    authors: result.authors ?? null,
    // Which kinds of file live where, whole-repository and then per area. The
    // scan writes it and the check never does: it is counts, not a directive.
    layout: result.layout ?? null,
    areas: result.areas.map((a) => ({
      id: a.id,
      path: a.path,
      globs: a.globs,
      fileCount: a.fileCount,
      kinds: a.kinds ?? null,
      // What this area's files import most, and what other files import out of
      // it. Null where the area has no static import surface to read, which is
      // a different fact from an area that imports nothing.
      imports: a.imports ?? null,
      reused: a.reused ?? null,
      dimensions: a.dimensions.map(slotRecord),
    })),
    // No key at all where nothing was written, which is every scan that names no other target.
    ...(named.length ? { targets: Object.fromEntries(named) } : {}),
    ...(going.length ? { removing: Object.fromEntries(going) } : {}),
  };
}

/** The refresh worker's last record in this checkout, read through F2's containment like every other store read, or null. */
export function refreshRecord(root) {
  const path = resolveInside(root, REFRESH_STATE);
  return path === null ? null : readRecord(path).record;
}
