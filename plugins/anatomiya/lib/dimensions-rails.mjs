import { walkRuby, constName, ownDef, site, args, options } from "./ruby-walk.mjs";
import { addPathSites, namesWellKnown } from "./stems.mjs";
import { RUBY_STRING_CAP } from "./limits.mjs";
import { underTestTree } from "./test-shape.mjs";
import { dirOf } from "./paths.mjs";

/**
 * Rails-data dimensions, same contract as the other dimension files: one claim,
 * three quantities, one `add` per candidate site (C1).
 *
 * Every one is anchored on an `ActiveRecord::Migration` subclass rather than on
 * a call name, and that anchor is the whole design. `run` receives a tree and no
 * path, so a directory cannot be part of a predicate; the class is the only
 * structural fact that says "this is a migration". It is also what keeps
 * db/schema.rb out: on a measured repository that one file holds 146
 * create_table calls, 2,570 column declarations and 870 index calls, and folded
 * into an area they give effectiveFiles 1 against a concentration gate of 3, so
 * bare call names would suppress the dimension while looking like a huge
 * population. schema.rb is a shape reference here and nothing else.
 *
 * Every one is `partial` for the same reason: a repository whose migrations
 * inherit a repository-local base class is invisible to the superclass test, so
 * applicability is under-counted in a case the parser cannot see. That is the
 * dangerous direction (C5), and a mixed repository would measure its convention
 * over the direct subclasses alone.
 */

const MIGRATION = /(^|::)ActiveRecord::Migration$/;
const TABLE_BLOCK = /^(create_table|change_table)$/;
const REFERENCE = /^(references|belongs_to)$/;
const ADD_REFERENCE = /^(add_reference|add_belongs_to)$/;

// SELECT is a read and is deliberately absent. WITH is here because a CTE can
// wrap an UPDATE; it has never fired on measured source. MERGE rewrites rows as
// surely as UPDATE does, and was read as schema work while it was missing.
const DML = /^(update|insert|delete|truncate|merge|with)\b/i;

/**
 * How each database a migration can run on reads a quote or a comment. A
 * migration names no database, so its SQL is read as each of them would, and a
 * statement any of them would run counts. PostgreSQL nests block comments,
 * quotes with `$tag$` and escapes only in `E''`, since `standard_conforming_strings`
 * is on from 9.1 and cannot be turned off from 19.
 */
const POSTGRES = { nests: true, dollar: true, escapeString: true };
// PL/pgSQL, as a DO block's code reads: a statement also starts after BEGIN, THEN, ELSE and LOOP.
const PLPGSQL = { ...POSTGRES, heads: true };
const OTHER_DIALECTS = [
  // MySQL escapes with a backslash in either quote, names in backticks, starts a
  // comment with `#` or with `--` and a space or a control character, and runs
  // what a `/*!` comment holds.
  { backslash: true, backtick: true, hash: true, dashSpace: true, bang: true },
  // SQLite neither nests nor escapes, and names in backticks too.
  { backtick: true },
];

// What an unquoted name is made of in all three, so a `$` inside one opens no dollar quote.
const NAME_PART = /[A-Za-z0-9_$\u0080-￿]/;
const PLPGSQL_HEAD = new RegExp(`^(?:begin|then|else|loop)(?!${NAME_PART.source})`, "i");
// PostgreSQL's own delimiter: a tag cannot start with a digit, which `$1` would be.
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;

/**
 * The statements of a SQL string as `dialect` reads it: split on each `;`
 * outside a quote and a comment, and at each NUL `firstString` puts where the
 * Ruby tree cut a line short, since the cut took that line's `;` with it. Each
 * piece is `{ body, afterCut, open, runs }`: its text from its first token, so
 * the verb test sees the verb behind any comment; whether it follows a cut;
 * whether it ends inside a block comment or a dollar quote, which a cut leaves
 * open past it, where a quote the cut left open is closed again, since its line
 * almost always closed it in the part the tree dropped; and for a DO statement
 * its dollar-quoted code, which runs as the migration does. The list is
 * `onlyPostgres` where it met a dollar quote or an `E''` string, which no other
 * database reads.
 */
function statements(sql, dialect) {
  const out = [];
  let first = -1;
  let afterCut = false;
  let runs = [];
  let mode = null;
  const end = (at, open) => {
    const body = first === -1 ? "" : sql.slice(first, at);
    out.push({ body, afterCut, open, runs: /^do\b/i.test(body) ? runs : [] });
    first = -1;
    runs = [];
  };
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "\0") {
      const carried = mode?.depth !== undefined || mode?.tag !== undefined;
      end(i, carried);
      afterCut = true;
      if (!carried) mode = null;
    } else if (mode?.quote !== undefined) {
      if (c === "\\" && mode.backslash) i++;
      else if (c === mode.quote) mode = null;
    } else if (mode?.line) {
      if (c === "\n") mode = null;
    } else if (mode?.depth !== undefined) {
      if (c === "*" && next === "/") {
        i++;
        if (--mode.depth === 0) mode = null;
      } else if (dialect.nests && c === "/" && next === "*") {
        i++;
        mode.depth++;
      }
    } else if (mode?.tag !== undefined) {
      if (sql.startsWith(mode.tag, i)) {
        runs.push(sql.slice(mode.from, i));
        i += mode.tag.length - 1;
        mode = null;
      }
    } else if (c === ";") {
      end(i, false);
      afterCut = false;
    } else if (dialect.heads && !NAME_PART.test(sql[i - 1] ?? "") && PLPGSQL_HEAD.test(sql.slice(i, i + 6))) {
      end(i, false);
      afterCut = false;
      i += PLPGSQL_HEAD.exec(sql.slice(i, i + 6))[0].length - 1;
    } else if ((c === "-" && next === "-" && (!dialect.dashSpace || /[\s\x01-\x1f]/.test(sql[i + 2] ?? ""))) || (c === "#" && dialect.hash)) {
      mode = { line: true };
    } else if (dialect.bang && c === "/" && next === "*" && sql[i + 2] === "!") {
      // What the comment holds is code, its version included.
      i += 2;
      while (/\d/.test(sql[i + 1] ?? "")) i++;
    } else if (c === "/" && next === "*") {
      // Past the opener's `*`, so `/*/` does not close as it opens.
      mode = { depth: 1 };
      i++;
    } else if (!/\s/.test(c)) {
      if (first === -1) first = i;
      if (c === "'") {
        const escaped = dialect.escapeString && /[Ee]/.test(sql[i - 1] ?? "") && !NAME_PART.test(sql[i - 2] ?? "");
        out.onlyPostgres ||= escaped;
        mode = { quote: "'", backslash: Boolean(dialect.backslash) || escaped };
      } else if (c === '"') {
        mode = { quote: '"', backslash: Boolean(dialect.backslash) };
      } else if (c === "`" && dialect.backtick) {
        mode = { quote: "`", backslash: false };
      } else if (c === "$" && dialect.dollar && !NAME_PART.test(sql[i - 1] ?? "")) {
        DOLLAR_TAG.lastIndex = i;
        const tag = DOLLAR_TAG.exec(sql)?.[0];
        if (tag) {
          out.onlyPostgres = true;
          mode = { tag, from: i + tag.length };
          i += tag.length - 1;
        }
      }
    }
  }
  end(sql.length, false);
  return out;
}

/**
 * What a migration's SQL does to rows, as any database it can run on reads it:
 * "data", "unread" or "schema". A dollar quote or an `E''` string is
 * PostgreSQL's alone, and then only its reading is asked.
 */
function sqlWork(sql) {
  const postgres = statements(sql, POSTGRES);
  let unread = false;
  for (const pieces of postgres.onlyPostgres ? [postgres] : [postgres, ...OTHER_DIALECTS.map((dialect) => statements(sql, dialect))]) {
    const work = piecesWork(pieces, sql.includes("\0"));
    if (work === "data") return "data";
    unread ||= work === "unread";
  }
  return unread ? "unread" : "schema";
}

/**
 * A PL/pgSQL head as the statement it runs: EXECUTE runs a string, so a literal
 * is read as the statement it holds, and a string built at run time may be any
 * statement, which is SQL this could not read.
 */
function executed(head) {
  const at = /^execute\s+/i.exec(head);
  if (!at) return head;
  const rest = head.slice(at[0].length);
  const opens = /^(?:[Ee]?'|\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$)/.exec(rest);
  return opens ? rest.slice(opens[0].length) : INTERPOLATED;
}

/**
 * "data" where a statement starts with a row-writing verb, or a DO block's code
 * does; "unread" where nothing was read, where an interpolation stands where a
 * statement starts, or where a cut left a data statement unseen. A piece after a
 * cut line that held statement text, `WITH (fillfactor = 90)` say, or after a
 * cut that left a block comment open, may be that statement's or comment's rest
 * rather than a statement of its own, so it starts none.
 */
function piecesWork(pieces, cut, heads = (body) => [body]) {
  const starts = pieces.filter((p, i) => !p.afterCut || (!pieces[i - 1].body && !pieces[i - 1].open)).flatMap((p) => heads(p.body));
  const runs = pieces.flatMap((p) => p.runs).map((code) => piecesWork(statements(code, PLPGSQL), code.includes("\0"), (body) => [executed(body)]));
  if (starts.some((head) => DML.test(head)) || runs.includes("data")) return "data";
  if (cut || !pieces.some((p) => p.body) || starts.some((head) => head.startsWith(INTERPOLATED)) || runs.includes("unread")) return "unread";
  return "schema";
}

export const COLUMN_TYPE = new Set([
  "string", "text", "integer", "bigint", "float", "decimal", "numeric", "datetime",
  "timestamp", "time", "date", "binary", "boolean", "json", "jsonb", "uuid", "inet",
  "cidr", "macaddr", "citext", "interval", "money", "hstore", "vector", "daterange",
  "tsvector", "xml", "column", "primary_key", "enum",
]);

/**
 * Constants a migration may name without touching data. Matched on the root
 * segment, so `ActiveRecord::Base.connection` and `Digest::MD5.hexdigest` are
 * covered by their first name, except a scoped constant under a
 * `FRAMEWORK_MODELS` root that receives a data call.
 * Anything outside it counts as a data touch,
 * which over-counts violations and so suppresses a directive rather than
 * stating one.
 */
export const FRAMEWORK = new Set([
  "ActiveRecord", "ActiveStorage", "ActionText", "ActiveSupport", "Arel", "Rails",
  "Time", "Date", "DateTime", "SecureRandom", "JSON", "YAML", "File", "Dir",
  "String", "Integer", "Float", "Numeric", "BigDecimal", "Array", "Hash", "Set",
  "Symbol", "Range", "Regexp", "Struct", "Math", "Kernel", "Object", "Comparable",
  "Enumerable", "URI", "Digest", "Base64", "Logger", "Marshal", "Process", "IO",
  "StringIO", "Pathname", "Tempfile", "OpenStruct", "Random", "Encoding",
]);

/** Symbols and strings spell the same identifier; migrations use one, schema.rb the other. */
const lit = (node) =>
  node && (node.t === "symbol" || node.t === "string") && typeof node.unescaped === "string"
    ? node.unescaped
    : null;

const isFalse = (node) => !!node && node.t === "false";

/**
 * Node kinds whose truthiness the source decides, which is all these rows ask
 * of a value. A local, a call, a constant or a conditional decides nothing:
 * `null: nullable` may be declaring `null: false` and `foreign_key: fk_options`
 * may be declaring nothing, so the site is declined rather than judged (C34).
 */
const DECIDED = new Set([
  "true", "false", "nil", "integer", "float", "rational", "imaginary", "string",
  "interpolated_string", "symbol", "interpolated_symbol", "hash", "keyword_hash",
  "array", "range",
]);

/** Whether this option was given a value this tool cannot decide. Absent is not one. */
const undecided = (node) => node !== undefined && !DECIDED.has(node?.t);
// Ruby truthiness, which is what Rails reads: everything but `false` and `nil`.
// `polymorphic: { limit: 255 }` is the type column's own options and
// `polymorphic: %i[quiz topic]` is the list of types; both are polymorphic.
const isTruthy = (node) => !!node && node.t !== "false" && node.t !== "nil";

const bare = (n, name) => n.t === "call" && !n.receiver && n.name === name;

const blockParam = (call) => {
  const req = call && call.block && call.block.parameters && call.block.parameters.parameters &&
    call.block.parameters.parameters.requireds;
  const first = Array.isArray(req) ? req[0] : null;
  return first && typeof first.name === "string" ? first.name : null;
};

// Whether a receiver is a local the enclosing block was handed, which is what
// `reversible` yields its direction as.
const isBlockParam = (receiver, ctx) =>
  !!receiver &&
  receiver.t === "local_variable_read" &&
  ctx.ancestors.some((a) => a.t === "call" && blockParam(a) === receiver.name);

/**
 * The table a column block is opened on, or null where the site is not inside
 * one. `inColumnBlock` asks whether, this asks which: a `t.references` owes its
 * foreign key on the table its `create_table` names, not on the column.
 */
function columnBlockTable(n, ctx) {
  const r = n.receiver;
  if (!r || r.t !== "local_variable_read") return null;
  for (let i = ctx.ancestors.length - 1; i >= 0; i--) {
    const a = ctx.ancestors[i];
    if (a.t !== "call" || a.receiver || blockParam(a) !== r.name) continue;
    if (TABLE_BLOCK.test(a.name)) return lit(args(a)[0]);
  }
  return null;
}

/**
 * The table name Rails derives from a reference name, both spellings a
 * repository writes: `:listing` owes `listings`, `:company` owes `companies`,
 * `:address` owes `addresses`.
 *
 * Three rules, not an inflector. A table whose name is irregular or uncountable
 * is caught by the equality below instead, and anything neither reaches is a
 * reference read as declaring no key, which under-counts conformance and so
 * suppresses a claim rather than stating one nobody holds.
 */
function pluralOf(name) {
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

/**
 * Every foreign key this migration declares as a statement of its own.
 *
 * `add_reference :ticket_comments, :user` followed by
 * `add_foreign_key :ticket_comments, :users` declares exactly what
 * `foreign_key: true` declares inline, and a measured Rails API writes 167 of
 * them against 12 inline options. Read as the inline option alone, a reference
 * the migration does constrain reads as a violation.
 *
 * The call is matched to the reference on the table it is added to and on the
 * column it covers, which is `column:` where the migration names one and the
 * plural of the reference otherwise. Matching on the table alone would credit
 * every reference in a migration that constrains one of them.
 */
function foreignKeys(cls) {
  const out = [];
  walkRuby(cls.body, (m, mctx) => {
    // `t.foreign_key` inside a table block is the same declaration written with
    // the block's receiver, and the table is the one the block opened.
    const onBlock = m.t === "call" && m.name === "foreign_key" && inColumnBlock(m, mctx);
    if (!bare(m, "add_foreign_key") && !onBlock) return;
    const list = args(m);
    const from = onBlock ? columnBlockTable(m, mctx) : lit(list[0]);
    const to = lit(list[onBlock ? 0 : 1]);
    const opts = options(m);
    const column = opts === null ? null : lit(opts.get("column"));
    // Which column the key covers is `column:` where it names one and the table
    // it points at otherwise, so an options list this tool could not read may
    // name one it cannot see. Kept rather than dropped: a statement whose column
    // is unknown may be the key covering a reference below.
    const unknownColumn = opts === null || (opts.has("column") ? column === null : to === null);
    out.push({ from, to, column, unknownColumn, down: isRollback(mctx) });
  });
  return out;
}

/**
 * Whether this node sits in the rollback direction. A column added only on the
 * way down does not exist going forward and neither does a key, so the two are
 * only ever evidence for each other within one direction. `def down`, and the
 * `dir.down` half of a `reversible` block, both say so; a bare `down` or one on
 * a constant is somebody else's method.
 */
const isRollback = (ctx) =>
  ctx.def?.name === "down" ||
  ctx.ancestors.some((a) => a.t === "call" && a.name === "down" && a.block && isBlockParam(a.receiver, ctx));

// Whether a key covers this reference's column: the one it names outright, or
// the table the reference's own name pluralises to. Asked only of a key whose
// column is known.
const covers = (k, name) =>
  k.column !== null ? k.column === `${name}_id` : k.to === pluralOf(name) || k.to === name;

// Whether one of them covers this reference: the same table, and its column.
const declaredApart = (keys, table, name, down) =>
  table !== null &&
  name !== null &&
  keys.some((k) => k.down === down && !k.unknownColumn && k.from === table && covers(k, name));

/**
 * Whether the key answering for this reference is unsettled: some statement in
 * the class may be it and nothing this tool read rules that out. Charging the
 * reference then invents a violation, so the row declines the site.
 *
 * Each half is ruled out on its own. A statement is on another table only where
 * both tables can be read and differ, and it covers another column only where
 * the reference names one and the statement's column is known. Blocking on one
 * unknown while the other rules the statement out drains a class of sites
 * nothing hid: a key on `editor_id` is not a reference on `author_id`, whatever
 * table it was added to.
 */
const unsettled = (keys, table, name, down) =>
  keys.some(
    (k) =>
      k.down === down &&
      (k.from === null || table === null || k.from === table) &&
      (name === null || k.unknownColumn || covers(k, name))
  );

function isMigrationClass(n) {
  if (!n || n.t !== "class" || !n.superclass) return false;
  const s = n.superclass;
  // `ActiveRecord::Migration[7.2]` is a `[]` call on the constant path.
  const named = s.t === "call" && s.name === "[]" ? constName(s.receiver) : constName(s);
  return MIGRATION.test(named || "");
}

/** A visitor handing each migration class to `fn`, which takes its own nested walk per class. */
function migrations(fn) {
  return {
    node(n) {
      if (isMigrationClass(n)) fn(n);
    },
  };
}

/**
 * The receiver names a column block the site actually sits inside, so a
 * `t.string` written outside any table block is not a column and a table block
 * whose parameter is named anything else is still read.
 */
function inColumnBlock(n, ctx, only = null) {
  const r = n.receiver;
  if (!r || r.t !== "local_variable_read") return false;
  for (let i = ctx.ancestors.length - 1; i >= 0; i--) {
    const a = ctx.ancestors[i];
    if (a.t !== "call" || a.receiver || blockParam(a) !== r.name) continue;
    // `only` narrows to one of the two block forms, for a row whose claim is
    // about a table the migration creates itself rather than about any column.
    if (only ? a.name === only : TABLE_BLOCK.test(a.name)) return true;
  }
  return false;
}

const BY_NAME = /^(method|send|public_send|__send__)$/;

/** The class's own methods by name, each with its body and parameters. */
function ownMethods(cls) {
  const own = new Map();
  walkRuby(cls.body, (d, ctx) => {
    if (ctx.enclosing !== null) return;
    if (d.t === "def" && ownDef(d)) own.set(d.name, { body: d.body, params: d.parameters });
    // `define_method(:up) { ... }` is a method body that runs.
    else if (bare(d, "define_method") && d.block && lit(args(d)[0])) {
      own.set(lit(args(d)[0]), { body: d.block.body, params: d.block.parameters?.parameters });
    }
  });
  return own;
}

/**
 * Every node Rails runs from the named methods: their bodies and, each once,
 * the bodies of this class's own methods they call. Both reversibility readers
 * go through here, so a helper is read by one exactly when it is read by the
 * other. `held(node, ctx)` marks code that does not run this way, and a helper
 * called only from there is not followed.
 */
function eachRun(cls, entries, visit, held = () => false) {
  const own = ownMethods(cls);
  const queue = entries.filter((name) => own.has(name));
  const seen = new Set(queue);
  for (const name of queue) {
    walkRuby(own.get(name).body, (n, ctx) => {
      if (held(n, ctx)) return;
      visit(n, ctx);
      if (n.t !== "call" || (n.receiver && n.receiver.t !== "self")) return;
      // `reversible(&method(:up_down))` and `send(:backfill)` name the method.
      const target = BY_NAME.test(n.name) ? lit(args(n)[0]) : n.name;
      if (own.has(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    });
  }
}

/**
 * Whether this migration rewrites rows, and whether anything in it could not be
 * read well enough to say.
 *
 * Two rows ask it. `migration_schema_only` answers with it, and
 * `migration_reversible` uses it to decide whether the question it asks applies
 * at all: `change` auto-inverts only a closed set of schema commands, so a
 * migration that updates rows cannot answer the reversibility claim however it
 * is written, and 88 of one repository's 121 reversibility violations sat on a
 * migration the other row also flagged.
 */
function dataWork(cls) {
  const local = new Set();
  walkRuby(cls.body, (m) => {
    if (m.t === "constant_write" && typeof m.name === "string") local.add(m.name);
  });

  let touches = false;
  let unreadable = false;
  const own = ownMethods(cls);
  // Locals, parameters and block parameters by name, each with a data call it receives.
  const carriers = new Map();
  const bound = [];
  // Constants handed to a call whose block sends a data call to a local.
  const reached = [];
  eachRun(cls, ["change", "up", "down"], (m, ctx) => {
    bound.push(...handed(m, own));
    if (m.t !== "call") return;
    if (m.block && m.receiver?.t !== "array" && !own.has(m.name) && !TABLE_BLOCK.test(m.name)) {
      let call = null;
      walkRuby(m.block, (b, bctx) => {
        call ??= b.t === "call" ? dataCallOnLocal(b, bctx)?.[1] : null;
      });
      if (call) for (const v of argValues(m)) reached.push([v, call]);
    }
    // Any SQL call, with a receiver or without: the framework whitelist
    // swallowed `ActiveRecord::Base.connection.execute`, so a migration
    // rewriting rows through it was checked by neither arm.
    if (sqlCall(m)) {
      // A heredoc that keeps its indentation can truncate to whitespace at the
      // string cap, and defaulting that to schema-only would state the
      // convention over migrations that rewrite rows.
      const sql = firstString(args(m));
      const work = sql === null ? "unread" : sqlWork(sql);
      if (work === "data") touches = true;
      else if (work === "unread") unreadable = true;
      return;
    }
    const onLocal = dataCallOnLocal(m, ctx);
    if (onLocal) carriers.set(...onLocal);
    const recv = constName(m.receiver) ?? built(m);
    if (recv && isModel(recv, local, m.name)) touches = true;
  });
  // `stale(model: User)`, `klass = User` and `[User, Account].each` hand the
  // model on, and it is data work only where it reaches a data call.
  // SCREAMING_CASE is a value rather than a class.
  for (const [v, call] of [...bound.map(([to, v]) => [v, carriers.get(to)]), ...reached]) {
    const name = constName(v);
    if (!name || !call || !/[a-z]/.test(name.slice(name.lastIndexOf(":") + 1))) continue;
    if (isModel(name, local, call)) touches = true;
  }

  return { touches, unreadable };
}

/**
 * What a node binds to a name, as [name, value] pairs: a local's value, each
 * value of a multiple assignment, an array literal's elements to the block
 * iterating it, and the arguments of a call to one of the class's own methods
 * to its parameters.
 */
function handed(n, own) {
  if (n.t === "local_variable_write") return [[n.name, n.value]];
  if (n.t === "multi_write" && n.value?.t === "array") {
    const values = n.value.elements || [];
    return (n.lefts || []).flatMap((l, i) => (typeof l.name === "string" && values[i] ? [[l.name, values[i]]] : []));
  }
  if (n.t !== "call") return [];
  if (n.receiver?.t === "array" && blockParam(n)) {
    return (n.receiver.elements || []).map((e) => [blockParam(n), e]);
  }
  const target = (!n.receiver || n.receiver.t === "self") && own.get(n.name);
  if (!target) return [];
  const params = target.params;
  const positional = [...(params?.requireds || []), ...(params?.optionals || [])];
  let i = 0;
  return args(n).flatMap((a) => {
    if (a.t === "hash" || a.t === "keyword_hash") {
      return (a.elements || []).filter((e) => lit(e.key)).map((e) => [lit(e.key), e.value]);
    }
    const p = positional[i++];
    return p && typeof p.name === "string" ? [[p.name, a]] : [];
  });
}

// SQL a migration hands the connection. A bare `update "UPDATE ..."` is the
// connection's, and its string first argument is what says so.
const SQL_CALL = /^(execute|exec_query|exec_update|exec_delete|exec_insert)$/;
const isText = (n) =>
  !!n && (n.t === "string" || n.t === "interpolated_string" || (n.t === "call" && isText(n.receiver)));
const sqlCall = (c) =>
  SQL_CALL.test(c.name) || (!c.receiver && /^(update|delete|insert)$/.test(c.name) && isText(args(c)[0]));

/**
 * A data call sent to a local, directly or through `new`, as [local, call]. A
 * table block's `t.references` is a column, whatever the call is named.
 */
function dataCallOnLocal(m, ctx) {
  const via = m.receiver?.t === "call" && /^(new|build)$/.test(m.receiver.name) ? m.receiver.receiver : m.receiver;
  if (via?.t !== "local_variable_read" || !DATA_CALLS.has(m.name) || inColumnBlock(m, ctx)) return null;
  return [via.name, m.name];
}

/** A call's positional arguments and keyword values. */
const argValues = (n) =>
  args(n).flatMap((a) => (a.t === "hash" || a.t === "keyword_hash" ? (a.elements || []).map((e) => e.value) : [a]));

/** The constant behind `Model.new(...).save!`, whose write is on the instance. */
const built = (m) =>
  m.receiver && m.receiver.t === "call" && /^(new|build)$/.test(m.receiver.name)
    ? constName(m.receiver.receiver)
    : null;

// Blocks that spell each direction themselves, so what they hold is not
// something `change` has to invert.
const SPELLED = /^(reversible|up_only)$/;

/**
 * Whether the method Rails runs forward, or a helper of the class it calls,
 * holds a command `change` cannot invert, in the form ActiveRecord's
 * CommandRecorder refuses. Rails runs `change` and never `up` when a class
 * defines both, so the caller names the one that runs. Options this tool
 * cannot read decide nothing (C33).
 */
function holdsIrreversible(cls, forward) {
  let found = false;
  eachRun(
    cls,
    [forward],
    (c, ctx) => {
      if (c.t === "call" && refused(c, ctx)) found = true;
    },
    (_, ctx) => ctx.ancestors.some((a) => a.t === "call" && !a.receiver && SPELLED.test(a.name))
  );
  return found;
}

// The change_table spellings of the commands CommandRecorder can refuse, which
// Rails sends on with the table as the first argument.
const TABLE_COMMAND = new Map([
  ["change", "change_column"],
  ["change_default", "change_column_default"],
  ["remove", "remove_columns"],
  ["remove_index", "remove_index"],
  ["remove_foreign_key", "remove_foreign_key"],
  ["remove_check_constraint", "remove_check_constraint"],
  ["remove_exclusion_constraint", "remove_exclusion_constraint"],
  ["remove_unique_constraint", "remove_unique_constraint"],
  ["unique_constraint", "add_unique_constraint"],
]);

const SEND = /^(send|public_send|__send__)$/;

function refused(c, ctx) {
  if (sqlCall(c)) return true;
  let list = args(c);
  let name = c.name;
  let extra = 0;
  // `send(:change_column, ...)` reaches the recorder as change_column.
  const sent = SEND.test(name) && (!c.receiver || c.receiver.t === "self") ? lit(list[0]) : null;
  if (sent) {
    name = sent;
    list = list.slice(1);
    if (SQL_CALL.test(name)) return true;
  } else if (c.receiver) {
    if (!TABLE_COMMAND.has(c.name) || !inColumnBlock(c, ctx, "change_table")) return false;
    name = TABLE_COMMAND.get(c.name);
    extra = 1;
  }
  const positional = list.filter((a) => a.t !== "hash" && a.t !== "keyword_hash").length + extra;
  switch (name) {
    case "change_column":
    case "add_enum_value":
      return true;
    case "remove_column":
      return positional <= 2;
    case "remove_columns":
      return lacks(c, "type");
    case "drop_table": {
      if (positional > 1) return true;
      // Rails drops the symbol :if_exists before asking whether any options
      // were given, and keeps a string key as one.
      const opts = options(c);
      if (c.block || opts === null) return false;
      const last = list.at(-1);
      const given = last && (last.t === "hash" || last.t === "keyword_hash") ? (last.elements || []).length : 0;
      return given === (opts.has("if_exists") ? 1 : 0);
    }
    case "change_column_default":
    case "change_column_comment":
    case "change_table_comment":
    case "rename_enum_value":
      return lacks(c, "from") || lacks(c, "to");
    case "remove_index":
      return positional < 2 && lacks(c, "column");
    case "remove_foreign_key":
      return positional < 2 && lacks(c, "to_table");
    // With no expression, columns or values there is nothing to re-create.
    case "remove_check_constraint":
    case "remove_exclusion_constraint":
    case "remove_unique_constraint":
    case "drop_enum":
      return positional < 2;
    case "drop_virtual_table":
      return positional < 3;
    case "add_unique_constraint": {
      const opts = options(c);
      return opts !== null && isTruthy(opts.get("using_index"));
    }
    default:
      return false;
  }
}

/** Whether the trailing options can be read and do not carry this key. */
function lacks(call, key) {
  const opts = options(call);
  return opts !== null && !opts.has(key);
}

// Framework roots whose scoped constants may be models: ActiveStorage::Blob
// and ActionText::RichText are tables, and ActiveRecord::SchemaMigration is one.
// They also name the connection, transactions, errors and a table name read
// for DDL, so a scoped constant under one is a model only as the receiver of
// one of DATA_CALLS: the class methods activerecord 8.1 gives a model to read
// or write rows (Querying's QUERYING_METHODS and SQL finders, `all`,
// `unscoped`, Persistence and CounterCache), and the instance writers `built`
// reaches through `new`.
const FRAMEWORK_MODELS = new Set(["ActiveStorage", "ActionText", "ActiveRecord"]);

export const DATA_CALLS = new Set([
  "find", "find_by", "find_by!", "take", "take!", "sole", "find_sole_by", "first", "first!", "last",
  "last!", "second", "second!", "third", "third!", "fourth", "fourth!", "fifth", "fifth!",
  "forty_two", "forty_two!", "third_to_last", "third_to_last!", "second_to_last", "second_to_last!",
  "exists?", "any?", "many?", "none?", "one?",
  "first_or_create", "first_or_create!", "first_or_initialize",
  "find_or_create_by", "find_or_create_by!", "find_or_initialize_by",
  "create_or_find_by", "create_or_find_by!",
  "destroy", "destroy_all", "delete", "delete_all", "update_all", "touch_all", "destroy_by", "delete_by",
  "find_each", "find_in_batches", "in_batches",
  "select", "reselect", "order", "regroup", "in_order_of", "reorder", "group", "limit", "offset",
  "joins", "left_joins", "left_outer_joins", "where", "rewhere", "invert_where", "preload",
  "extract_associated", "eager_load", "includes", "from", "lock", "readonly", "and", "or",
  "annotate", "optimizer_hints", "extending", "having", "create_with", "distinct", "references",
  "none", "unscope", "merge", "except", "only",
  "count", "average", "minimum", "maximum", "sum", "calculate",
  "pluck", "pick", "ids", "async_ids", "strict_loading", "excluding", "without", "with_recursive",
  "async_count", "async_average", "async_minimum", "async_maximum", "async_sum", "async_pluck", "async_pick",
  "insert", "insert_all", "insert!", "insert_all!", "upsert", "upsert_all",
  "with", "find_by_sql", "async_find_by_sql", "count_by_sql", "async_count_by_sql",
  "all", "unscoped",
  "create", "create!", "update", "update!",
  "increment_counter", "decrement_counter", "update_counters", "reset_counters",
  "save", "save!", "destroy!", "update_attribute", "update_attribute!", "update_column",
  "update_columns", "increment!", "decrement!", "toggle!", "reload", "touch",
]);

function isModel(name, local, method = null) {
  const root = name.split("::")[0];
  // A constant the migration assigned itself is an index name, not a model.
  if (local.has(root) || local.has(name)) return false;
  if (FRAMEWORK_MODELS.has(root)) return name !== root && DATA_CALLS.has(method);
  return !FRAMEWORK.has(root);
}

const ROUTE_VERBS = new Set(["get", "post", "put", "patch", "delete", "match", "options", "head"]);
const ROUTE_RESOURCES = new Set(["resources", "resource"]);
const ROUTE_CALLS = new Set([...ROUTE_VERBS, ...ROUTE_RESOURCES, "namespace", "scope"]);

// The Ruby tree keeps `RUBY_STRING_CAP` characters of a string, so one that long may be cut short.
const cutShort = (text) => [...text].length >= RUBY_STRING_CAP;
// What `firstString` leaves where an interpolation sat: SQL this tool never sees.
const INTERPOLATED = "\u0001";

/** A literal path with whether it may be cut short, or none for anything else. */
function pathOf(node) {
  const text = lit(node);
  return text === null ? [] : [{ text, cut: cutShort(text) }];
}

/**
 * What a route call in a Rails routes file names as its path, or none.
 *
 * A symbol is a path too: `resources :support_tickets` serves
 * `/support_tickets` unless a `path:` option says otherwise, and that default
 * is exactly where a kebab-case team writes the option. A verb's first argument
 * is the path, or the key of `get "a" => "c#a"`. `scope module:` names a
 * namespace and no path, and `member`, `collection`, `concern` and `root` name
 * none either.
 */
function routePaths(n) {
  if (n.t !== "call" || n.receiver || !ROUTE_CALLS.has(n.name)) return [];
  const list = args(n);
  const first = list[0];
  // `get "a" => "c#a"`: with no path before the options, Rails takes their first string key.
  if (ROUTE_VERBS.has(n.name) && (first?.t === "keyword_hash" || first?.t === "hash")) {
    const key = (first.elements || []).find((el) => el?.key?.t === "string" || el?.key?.t === "interpolated_string")?.key;
    return pathOf(key);
  }
  // A verb's string is the path whatever the options say.
  if (ROUTE_VERBS.has(n.name) && first?.t === "string") return pathOf(first);
  // A scope's own arguments are its path, joined, and one this cannot read hides it.
  if (n.name === "scope") {
    const positional = list.filter((a) => a.t !== "keyword_hash" && a.t !== "hash");
    if (positional.length) {
      const parts = positional.map(lit);
      // Only the last part's cut can be told from a word; an earlier one cut short hides the path.
      if (parts.includes(null) || parts.slice(0, -1).some(cutShort)) return [];
      return [{ text: parts.join("/"), cut: cutShort(parts[parts.length - 1]) }];
    }
  }
  // A `path:` replaces the name of a namespace or a resource, and options this cannot read may hold one (C33).
  const opts = options(n);
  if (opts === null) return [];
  if (opts.has("path")) return pathOf(opts.get("path"));
  if (ROUTE_VERBS.has(n.name) || n.name === "namespace") return pathOf(first);
  return list.flatMap((a) => (a.t === "symbol" ? pathOf(a) : []));
}

const ROUTES_FILE = /(?:^|\/)config\/routes(?:\.rb|\/.+\.rb)$/;

// `Rails.application.routes.draw do`, an engine's `Engine.routes.draw do`.
const drawsRoutes = (n) => n.t === "call" && n.name === "draw" && n.receiver?.t === "call" && n.receiver.name === "routes";

export const RAILS_DIMENSIONS = [
  {
    key: "route_segment_case",
    tier: "syntactic",
    learnedClasses: true,
    claim: "URL path segments here are <style>",
    counterClaim: null, // the other side is another class, which the learning already picks
    precision: "partial",
    applicabilityPredicate: {
      sites:
        "a word of a path a Rails route declares, in config/routes.rb, a file under config/routes, or a routes.draw block: the string of get, post, put, patch, delete, match, options and head, a verb's symbol unless a path: option replaces it, the first string key of `get \"a\" => \"c#a\"`, a scope's own arguments joined or else its path: option, a namespace's name unless a path: option replaces it, and each resources or resource symbol unless a path: option replaces it. A parameter (`:id`, `*path`, `(.:format)`) is Rails's syntax, what sits under `.well-known` a standard names, and the last word of a string as long as the " + RUBY_STRING_CAP + " characters the Ruby tree keeps of one may be cut short, so none of those is a site; nor is a single word, `users` or `Users`, a route under a test tree such as an engine's `spec/dummy`, or a path whose `path:` option or string this cannot read",
      blind: "a path built at run time, from an interpolated string, a constant or a method call, and a route declared through a helper this does not read, name segments this never sees",
    },
    langs: ["ruby"],
    visitor(ast, add, { rel } = {}) {
      // An engine's dummy app under `spec` or `test` stands in for the application that mounts it.
      if (underTestTree(dirOf(rel ?? ""), "ruby")) return { node() {} };
      const file = ROUTES_FILE.test(rel ?? "");
      return {
        node(n, ctx) {
          const paths = routePaths(n);
          if (!paths.length) return;
          if (!file && !ctx.ancestors.some(drawsRoutes)) return;
          // A standard names what sits under `.well-known`, however a scope spells it.
          if (ctx.ancestors.some((a) => routePaths(a).some((p) => namesWellKnown(p.text)))) return;
          // A call is the declaration: `resources :a, :b` declares both at once.
          // Prism gives no offset, so its line and its paths tell two calls apart.
          const declared = `${n.name} ${paths.map((p) => p.text).join(" ")}`;
          const section = `${n.line ?? ""} ${declared}`;
          // The name is the site's identity in the check: its paths, never its
          // line, or a route above it moving would make it new.
          const node = { ...site(n), name: declared };
          for (const { text, cut } of paths) addPathSites(add, node, text, section, { mayBeCut: cut });
        },
      };
    },
  },
  {
    key: "migration_reversible",
    tier: "syntactic",
    claim: "migrations declare change, not up and down",
    counterClaim: null, // no measured spread across repositories yet, and a counter needs the same bar the claim does
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class defining at least one of change, up or down, unless it rewrites rows or carries SQL this tool could not read: those are answered by migration_schema_only, and change cannot invert either. Nor is one whose change, or up where there is no change, or a method of the class either one calls, holds a command change cannot invert outside a reversible or up_only block: an execute, exec_query, exec_update, exec_delete or exec_insert, a bare update, delete or insert handed an SQL string, a change_column, an add_enum_value, a remove_column with no positional type, a remove_columns with no type:, a drop_table naming several tables or with neither a block nor an option other than the symbol if_exists:, a change_column_default, comment change or rename_enum_value with no from: and to:, a remove_index with no column, a remove_foreign_key with no second table, a remove_check_constraint, remove_exclusion_constraint or remove_unique_constraint with nothing after the table, a drop_enum with no values, a drop_virtual_table with no values, an add_unique_constraint with using_index:, or the change_table or send spelling of any of these",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    visitor(ast, add) {
      return migrations((cls) => {
        // A migration that rewrites rows is answered by `migration_schema_only`,
        // and asking it to declare `change` asks for a rollback that either
        // silently re-runs the update forward or raises
        // ActiveRecord::IrreversibleMigration. An `execute` nobody could read is
        // raw SQL, which is precisely where up and down is the correct form.
        const data = dataWork(cls);
        if (data.touches || data.unreadable) return;
        const defs = new Set();
        walkRuby(cls.body, (m, mctx) => {
          if (mctx.enclosing !== null || !ownDef(m)) return;
          defs.add(m.name);
        });
        if (!defs.has("change") && !defs.has("up") && !defs.has("down")) return;
        // `change` has no spelling of a command Rails cannot invert, so a
        // migration holding one cannot conform and its up/down is correct.
        if (holdsIrreversible(cls, defs.has("change") ? "change" : "up")) return;
        // Defining both is a migration Rails cannot roll back, so it is a
        // violation rather than the good case.
        const reversible = defs.has("change") && !defs.has("up") && !defs.has("down");
        add({ node: site(cls), conforming: reversible, where: cls.name ?? null });
      });
    },
  },

  {
    key: "migration_schema_only",
    tier: "syntactic",
    claim: "migrations change the schema and leave the data alone",
    counterClaim: null, // the inverse rewrites rows from inside a schema migration
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class, unless one of its SQL calls (execute, exec_query, exec_update, exec_delete, exec_insert, or a bare update, delete or insert handed a string) carries SQL this tool could not read and nothing else in the class rewrites rows. SQL is read as far as the Ruby tree keeps it, " + RUBY_STRING_CAP + " characters of a string or of a heredoc line, so a cut string is SQL it could not read unless a data statement starts before the cut or after a `;` it keeps, and so is an interpolation where a statement starts",
      blind: "SQL this tool could not read drops a class nothing else in it marks as rewriting rows, and a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    visitor(ast, add) {
      return migrations((cls) => {
        const { touches, unreadable } = dataWork(cls);
        if (unreadable && !touches) return;
        add({ node: site(cls), conforming: !touches, where: cls.name ?? null });
      });
    },
  },

  {
    key: "column_null_declared",
    tier: "syntactic",
    claim: "a column on a table the migration creates is declared null: false",
    counterClaim: null, // a missing option is an omission, not a nullability decision
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class adding a column to a table it creates itself, through a typed t. call inside a create_table block, and only where its options list can be read and its null: value is one this tool can decide. A column on an existing table is not one: on a populated table `null: false` without a default raises PG::NotNullViolation, so the conforming form does not run",
      notCounted:
        "a column whose options this tool cannot read: a ** splat, a key that is not written out, or a null: it cannot decide",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    visitor(ast, add) {
      return migrations((cls) => {
        walkRuby(cls.body, (m, mctx) => {
          if (m.t !== "call") return;
          const isColumn = COLUMN_TYPE.has(m.name) && inColumnBlock(m, mctx, "create_table");
          if (!isColumn) return;
          const opts = options(m);
          if (opts === null) return;
          const declared = opts.get("null");
          if (undecided(declared)) return;
          add({ node: site(m), conforming: isFalse(declared), where: cls.name ?? null });
        });
      });
    },
  },

  {
    key: "table_primary_key_declared",
    tier: "syntactic",
    claim: "new tables declare their primary key type",
    counterClaim: null, // almost no application passes id:, so the inverse would state everywhere and name no type
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class calling create_table with a table name and a readable options list",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    visitor(ast, add) {
      return migrations((cls) => {
        walkRuby(cls.body, (m) => {
          if (!bare(m, "create_table")) return;
          if (lit(args(m)[0]) === null) return;
          const opts = options(m);
          if (opts === null) return;
          // `id: false` on a join table is an explicit choice and counts.
          add({ node: site(m), conforming: opts.has("id"), where: cls.name ?? null });
        });
      });
    },
  },

  {
    key: "reference_foreign_key",
    tier: "syntactic",
    claim: "reference columns declare their foreign key",
    counterClaim: null, // telling an agent to drop the constraint is a data-integrity cost with no ceiling
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class adding a reference column, through add_reference or add_belongs_to or the matching t. call inside a create_table or change_table block, and only where its options list can be read, its foreign_key: value is one this tool can decide, and its key is settled: declared in those options, matched to a statement of its own in the same direction, or ruled out because every statement in that direction names another table or another column. A polymorphic reference is not one, since ActiveRecord refuses a foreign key on a polymorphic relation, unless the options name the types as a list and declare the key beside it, which is a repository saying the form runs there",
      notCounted:
        "a polymorphic reference declaring no key of its own, and one whose options or key this tool could not settle",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    visitor(ast, add) {
      return migrations((cls) => {
        const keys = foreignKeys(cls);
        walkRuby(cls.body, (m, mctx) => {
          if (m.t !== "call") return;
          const added = !m.receiver && ADD_REFERENCE.test(m.name);
          const isRef = added || (REFERENCE.test(m.name) && inColumnBlock(m, mctx));
          if (!isRef) return;
          const opts = options(m);
          if (opts === null) return;
          const list = args(m);
          // `add_reference :table, :name` names both; `t.references :name`
          // names the column and its block names the table.
          const table = added ? lit(list[0]) : columnBlockTable(m, mctx);
          const name = lit(list[added ? 1 : 0]);
          const fk = opts.get("foreign_key");
          if (undecided(fk)) return;
          // Rails adds nothing for a falsy `foreign_key:`, so `nil` declares no
          // more than `false` does. `null:` is the one option compared against
          // the literal false instead, because Rails compares it that way.
          const inline = isTruthy(fk);
          // ActiveRecord raises `ArgumentError: Cannot add a foreign key to a
          // polymorphic relation`, so the conforming form does not run and the
          // column carries a type instead of a constraint. The list form is the
          // exception: canvas-lms expands `polymorphic: %i[account course]` into
          // one real reference per type and passes `foreign_key:` to each, so
          // where the options declare the key beside a list, it is declared.
          const poly = opts.get("polymorphic");
          if (isTruthy(poly) && !(inline && poly.t === "array")) return;
          const down = isRollback(mctx);
          const apart = declaredApart(keys, table, name, down);
          if (!inline && !apart && unsettled(keys, table, name, down)) return;
          add({ node: site(m), conforming: inline || apart, where: cls.name ?? null });
        });
      });
    },
  },

];

/**
 * The first argument's text, through its receiver chain (`<<~SQL.squish`).
 * A later argument is a statement name and a nested call's string is its own
 * argument, so neither is read as the SQL. A squiggly heredoc parses as one
 * string part per line, so the parts are joined to reach later statements. A
 * NUL follows every text as long as the cap the Ruby tree keeps, since it may
 * have been cut there: a part that ends in a newline at the cap is no proof.
 */
function firstString(list) {
  let n = list[0];
  while (n?.t === "call") n = n.receiver;
  const kept = (text) => (cutShort(text) ? `${text}\0` : text);
  if (n?.t === "string") return typeof n.unescaped === "string" ? kept(n.unescaped) : null;
  if (n?.t !== "interpolated_string") return null;
  return n.parts
    .map((p) => (p.t === "string" && typeof p.unescaped === "string" ? kept(p.unescaped) : INTERPOLATED))
    .join("");
}
