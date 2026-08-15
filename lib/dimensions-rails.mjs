import { walkRuby, constName } from "./ruby.mjs";

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
// wrap an UPDATE; it has never fired on measured source.
const DML = /^(update|insert|delete|truncate|with)\b/i;

const COLUMN_TYPE = new Set([
  "string", "text", "integer", "bigint", "float", "decimal", "numeric", "datetime",
  "timestamp", "time", "date", "binary", "boolean", "json", "jsonb", "uuid", "inet",
  "cidr", "macaddr", "citext", "interval", "money", "hstore", "vector", "daterange",
  "tsvector", "xml", "column", "primary_key", "enum",
]);

/**
 * Constants a migration may name without touching data. Matched on the root
 * segment, so `ActiveRecord::Base.connection` and `Digest::MD5.hexdigest` are
 * covered by their first name. Anything outside it counts as a data touch,
 * which over-counts violations and so suppresses a directive rather than
 * stating one.
 */
const FRAMEWORK = new Set([
  "ActiveRecord", "ActiveStorage", "ActionText", "ActiveSupport", "Arel", "Rails",
  "Time", "Date", "DateTime", "SecureRandom", "JSON", "YAML", "File", "Dir",
  "String", "Integer", "Float", "Numeric", "BigDecimal", "Array", "Hash", "Set",
  "Symbol", "Range", "Regexp", "Struct", "Math", "Kernel", "Object", "Comparable",
  "Enumerable", "URI", "Digest", "Base64", "Logger", "Marshal", "Process", "IO",
  "StringIO", "Pathname", "Tempfile", "OpenStruct", "Random", "Encoding",
]);

const site = (n) => ({
  type: n.t,
  name: typeof n.name === "string" ? n.name : null,
  line: typeof n.line === "number" ? n.line : null,
  start: null,
  end: null,
});

const args = (call) => (call && call.arguments && call.arguments.arguments) || [];

/** Symbols and strings spell the same identifier; migrations use one, schema.rb the other. */
const lit = (node) =>
  node && (node.t === "symbol" || node.t === "string") && typeof node.unescaped === "string"
    ? node.unescaped
    : null;

const isFalse = (node) => !!node && node.t === "false";

const bare = (n, name) => n.t === "call" && !n.receiver && n.name === name;

/** `def self.up` is a def with a self receiver, and four measured files are written that way. */
const ownDef = (n) => n.t === "def" && (!n.receiver || n.receiver.t === "self");

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
 */
function options(call) {
  const list = args(call);
  const last = list[list.length - 1];
  if (!last || (last.t !== "keyword_hash" && last.t !== "hash")) return new Map();
  const out = new Map();
  for (const el of last.elements || []) {
    if (!el || el.t === "assoc_splat" || !el.key) return null;
    const key = lit(el.key);
    if (key !== null) out.set(key, el.value);
  }
  return out;
}

function isMigrationClass(n) {
  if (!n || n.t !== "class" || !n.superclass) return false;
  const s = n.superclass;
  // `ActiveRecord::Migration[7.2]` is a `[]` call on the constant path.
  const named = s.t === "call" && s.name === "[]" ? constName(s.receiver) : constName(s);
  return MIGRATION.test(named || "");
}

/** Every migration class in one tree, with its own nested walk per class. */
function eachMigration(ast, fn) {
  walkRuby(ast, (n) => {
    if (isMigrationClass(n)) fn(n);
  });
}

/**
 * The receiver names a column block the site actually sits inside, so a
 * `t.string` written outside any table block is not a column and a table block
 * whose parameter is named anything else is still read.
 */
function inColumnBlock(n, ctx) {
  const r = n.receiver;
  if (!r || r.t !== "local_variable_read") return false;
  for (let i = ctx.ancestors.length - 1; i >= 0; i--) {
    const a = ctx.ancestors[i];
    if (a.t === "call" && !a.receiver && TABLE_BLOCK.test(a.name) && blockParam(a) === r.name) {
      return true;
    }
  }
  return false;
}

export const RAILS_DIMENSIONS = [
  {
    key: "migration_reversible",
    claim: "migrations declare change, not up and down",
    counterClaim: null, // no measured spread across repositories yet, and a counter needs the same bar the claim does
    precision: "partial", // a repository-local base class hides the migration from the superclass test
    langs: ["ruby"],
    // Applicable: a migration class defining at least one of change/up/down. A
    // helper-only class has made no choice about reversibility, so counting it
    // would pad the numerator with classes the claim is not about.
    run(ast, add) {
      eachMigration(ast, (cls) => {
        const defs = new Set();
        walkRuby(cls.body, (m, mctx) => {
          if (mctx.enclosing !== null || !ownDef(m)) return;
          defs.add(m.name);
        });
        if (!defs.has("change") && !defs.has("up") && !defs.has("down")) return;
        // Defining both is a migration Rails cannot roll back, so it is a
        // violation rather than the good case.
        const reversible = defs.has("change") && !defs.has("up") && !defs.has("down");
        add({ node: site(cls), conforming: reversible, where: cls.name ?? null });
      });
    },
  },

  {
    key: "migration_schema_only",
    claim: "migrations change the schema and leave the data alone",
    counterClaim: null, // the inverse rewrites rows from inside a schema migration
    precision: "partial", // an unreadable execute drops the class, and a local base class hides it
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
        const local = new Set();
        walkRuby(cls.body, (m) => {
          if (m.t === "constant_write" && typeof m.name === "string") local.add(m.name);
        });

        let touchesData = false;
        let unreadable = false;
        walkRuby(cls.body, (m) => {
          if (m.t !== "call") return;
          // Any `execute`, with a receiver or without: the framework whitelist
          // swallowed `ActiveRecord::Base.connection.execute`, so a migration
          // rewriting rows through it was checked by neither arm.
          if (m.name === "execute") {
            const sql = firstString(args(m));
            // A heredoc that keeps its indentation can truncate to whitespace
            // at the string cap, and defaulting that to schema-only would state
            // the convention over migrations that rewrite rows.
            if (sql === null || sql.trimStart() === "") unreadable = true;
            else if (DML.test(sql.trimStart())) touchesData = true;
            return;
          }
          const recv = constName(m.receiver);
          if (!recv) return;
          // A constant the migration assigned itself is an index name, not a model.
          if (local.has(recv.split("::")[0]) || local.has(recv)) return;
          if (!FRAMEWORK.has(recv.split("::")[0])) touchesData = true;
        });

        if (unreadable) return;
        add({ node: site(cls), conforming: !touchesData, where: cls.name ?? null });
      });
    },
  },

  {
    key: "column_null_declared",
    claim: "new columns are declared null: false",
    counterClaim: null, // a missing option is an omission, not a nullability decision
    precision: "partial", // a repository-local base class hides the migration from the superclass test
    langs: ["ruby"],
    // Candidates: a column being added, either through add_column or through a
    // create_table/change_table block. change_column and change_column_null
    // alter a column that already exists rather than declare a new one, and
    // t.timestamps and t.references are not nullability the writer chose.
    run(ast, add) {
      eachMigration(ast, (cls) => {
        walkRuby(cls.body, (m, mctx) => {
          if (m.t !== "call") return;
          const isColumn = bare(m, "add_column") || (COLUMN_TYPE.has(m.name) && inColumnBlock(m, mctx));
          if (!isColumn) return;
          const opts = options(m);
          if (opts === null) return;
          add({ node: site(m), conforming: isFalse(opts.get("null")), where: cls.name ?? null });
        });
      });
    },
  },

  {
    key: "table_primary_key_declared",
    claim: "new tables declare their primary key type",
    counterClaim: null, // almost no application passes id:, so the inverse would state everywhere and name no type
    precision: "partial", // a repository-local base class hides the migration from the superclass test
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
        walkRuby(cls.body, (m) => {
          if (!m.t || m.t !== "call" || !bare(m, "create_table")) return;
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
    claim: "reference columns declare their foreign key",
    counterClaim: null, // telling an agent to drop the constraint is a data-integrity cost with no ceiling
    precision: "partial", // a repository-local base class hides the migration from the superclass test
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
        walkRuby(cls.body, (m, mctx) => {
          if (m.t !== "call") return;
          const isRef =
            (!m.receiver && ADD_REFERENCE.test(m.name)) ||
            (REFERENCE.test(m.name) && inColumnBlock(m, mctx));
          if (!isRef) return;
          const opts = options(m);
          if (opts === null) return;
          const fk = opts.get("foreign_key");
          add({ node: site(m), conforming: fk !== undefined && !isFalse(fk), where: cls.name ?? null });
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
