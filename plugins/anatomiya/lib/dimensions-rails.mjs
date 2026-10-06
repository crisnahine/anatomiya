import { walkRuby, constName, ownDef, site, args } from "./ruby-walk.mjs";

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
 * The SQL with its leading comments removed, so the verb test sees the verb.
 *
 * Anchored at the start, `-- backfill` or `/* x *\/` ahead of an UPDATE read as
 * DDL and the migration was stated as leaving data alone. A comment the string
 * cap cut off before it closed leaves nothing, which is unreadable rather than
 * schema-only, as a heredoc truncated to whitespace already is.
 */
function sqlBody(sql) {
  let s = sql.trimStart();
  for (;;) {
    if (s.startsWith("--")) {
      const end = s.indexOf("\n");
      s = end === -1 ? "" : s.slice(end + 1).trimStart();
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/", 2);
      s = end === -1 ? "" : s.slice(end + 2).trimStart();
    } else {
      return s;
    }
  }
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

/**
 * The trailing option hash as a Map of symbol name to value node, or null when
 * the set is unknowable. `{ null: false }` parses as `hash` and `null: false` as
 * `keyword_hash`, so reading one spelling reports a conforming site as a
 * violation. `**opts` parses as an `assoc_splat` with no key: the options cannot
 * be read, so the site is dropped rather than counted as having none.
 *
 * A key that is not written out hides which option was set, so one of them can
 * be the option the row asks for: `key => false`, `CONST => 1` and
 * `:"#{name}" => 1` void the list the way a splat does (C33).
 */
function options(call) {
  const list = args(call);
  const last = list[list.length - 1];
  if (!last || (last.t !== "keyword_hash" && last.t !== "hash")) return new Map();
  const out = new Map();
  for (const el of last.elements || []) {
    if (!el || el.t === "assoc_splat" || !el.key) return null;
    // Rails looks the option up by symbol, so `"null" => false` is a hash entry
    // and not the `null:` option. Read, and read as not being it: a string key
    // is skipped rather than voiding the list, whatever it interpolates to.
    if (el.key.t === "string" || el.key.t === "interpolated_string") continue;
    if (el.key.t !== "symbol" || typeof el.key.unescaped !== "string") return null;
    out.set(el.key.unescaped, el.value);
  }
  return out;
}

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
 * `foreign_key: true` declares inline, and empire-flippers/api writes 167 of
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
      const sql = firstString(args(m));
      // A heredoc that keeps its indentation can truncate to whitespace at the
      // string cap, and defaulting that to schema-only would state the
      // convention over migrations that rewrite rows.
      const body = sql === null ? "" : sqlBody(sql);
      if (body === "") unreadable = true;
      else if (DML.test(body)) touches = true;
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

export const RAILS_DIMENSIONS = [
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
      sites: "a migration class, unless one of its SQL calls (execute, exec_query, exec_update, exec_delete, exec_insert, or a bare update, delete or insert handed a string) carries SQL this tool could not read",
      blind: "unreadable SQL drops the class, and a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    visitor(ast, add) {
      return migrations((cls) => {
        const { touches, unreadable } = dataWork(cls);
        if (unreadable) return;
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

/** The first string leaf under a call's arguments: `<<~SQL.squish` hides it behind a call. */
function firstString(list) {
  let found = null;
  walkRuby(list, (n) => {
    if (found === null && n.t === "string" && typeof n.unescaped === "string") found = n.unescaped;
  });
  return found;
}
