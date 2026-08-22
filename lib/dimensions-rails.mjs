import { walkRuby, constName, ownDef } from "./ruby-walk.mjs";

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

export const COLUMN_TYPE = new Set([
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
const isTrue = (node) => !!node && node.t === "true";

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
    // A key added only on the way down does not exist going forward, which is
    // the direction the column is added in. `def down`, and the `dir.down`
    // half of a `reversible` block, both say so.
    if (mctx.def?.name === "down") return;
    // `dir.down`, where the receiver is the block parameter `reversible` yields.
    // A bare `down` or one on a constant is somebody else's method.
    if (mctx.ancestors.some((a) => a.t === "call" && a.name === "down" && a.block && isBlockParam(a.receiver, mctx))) {
      return;
    }
    // `t.foreign_key` inside a table block is the same declaration written with
    // the block's receiver, and the table is the one the block opened.
    const onBlock = m.t === "call" && m.name === "foreign_key" && inColumnBlock(m, mctx);
    if (!bare(m, "add_foreign_key") && !onBlock) return;
    const list = args(m);
    const from = onBlock ? columnBlockTable(m, mctx) : lit(list[0]);
    const to = lit(list[onBlock ? 0 : 1]);
    if (from === null) return;
    const opts = options(m);
    out.push({ from, to, column: opts === null ? null : lit(opts.get("column")) });
  });
  return out;
}

// Whether one of them covers this reference: the same table, and either the
// column named outright or the table the reference's own name pluralises to.
const declaredApart = (keys, table, name) =>
  table !== null &&
  name !== null &&
  keys.some(
    (k) => k.from === table && (k.column !== null ? k.column === `${name}_id` : k.to === pluralOf(name) || k.to === name)
  );

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
  walkRuby(cls.body, (m) => {
    if (m.t !== "call") return;
    // Any `execute`, with a receiver or without: the framework whitelist
    // swallowed `ActiveRecord::Base.connection.execute`, so a migration
    // rewriting rows through it was checked by neither arm.
    if (m.name === "execute") {
      const sql = firstString(args(m));
      // A heredoc that keeps its indentation can truncate to whitespace at the
      // string cap, and defaulting that to schema-only would state the
      // convention over migrations that rewrite rows.
      if (sql === null || sql.trimStart() === "") unreadable = true;
      else if (DML.test(sql.trimStart())) touches = true;
      return;
    }
    const recv = constName(m.receiver);
    if (!recv) return;
    // A constant the migration assigned itself is an index name, not a model.
    if (local.has(recv.split("::")[0]) || local.has(recv)) return;
    if (!FRAMEWORK.has(recv.split("::")[0])) touches = true;
  });

  return { touches, unreadable };
}

export const RAILS_DIMENSIONS = [
  {
    key: "migration_reversible",
    tier: "syntactic",
    claim: "migrations declare change, not up and down",
    counterClaim: null, // no measured spread across repositories yet, and a counter needs the same bar the claim does
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class defining at least one of change, up or down, unless it rewrites rows or carries an execute this tool could not read: those are answered by migration_schema_only, and change cannot invert either",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
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
      sites: "a migration class, unless one of its execute calls carries SQL this tool could not read",
      blind: "an unreadable execute drops the class, and a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
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
      sites: "a migration class adding a column to a table it creates itself, through a typed t. call inside a create_table block, and only where its options list can be read. A column on an existing table is not one: on a populated table `null: false` without a default raises PG::NotNullViolation, so the conforming form does not run",
      notCounted:
        "a column whose options are a ** splat, which this tool cannot read",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
        walkRuby(cls.body, (m, mctx) => {
          if (m.t !== "call") return;
          const isColumn = COLUMN_TYPE.has(m.name) && inColumnBlock(m, mctx, "create_table");
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
    tier: "syntactic",
    claim: "new tables declare their primary key type",
    counterClaim: null, // almost no application passes id:, so the inverse would state everywhere and name no type
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class calling create_table with a table name and a readable options list",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
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
    tier: "syntactic",
    claim: "reference columns declare their foreign key",
    counterClaim: null, // telling an agent to drop the constraint is a data-integrity cost with no ceiling
    precision: "partial",
    applicabilityPredicate: {
      sites: "a migration class adding a reference column, through add_reference or add_belongs_to or the matching t. call inside a create_table or change_table block, and only where its options list can be read. A polymorphic reference is not one: ActiveRecord refuses a foreign key on it",
      notCounted:
        "a reference marked polymorphic: true, and one whose options are a ** splat",
      blind: "a repository-local base class hides the migration from the superclass test",
    },
    langs: ["ruby"],
    run(ast, add) {
      eachMigration(ast, (cls) => {
        const keys = foreignKeys(cls);
        walkRuby(cls.body, (m, mctx) => {
          if (m.t !== "call") return;
          const added = !m.receiver && ADD_REFERENCE.test(m.name);
          const isRef = added || (REFERENCE.test(m.name) && inColumnBlock(m, mctx));
          if (!isRef) return;
          const opts = options(m);
          if (opts === null) return;
          // ActiveRecord raises `ArgumentError: Cannot add a foreign key to a
          // polymorphic relation`, so the conforming form does not run and the
          // column carries a type instead of a constraint.
          if (isTrue(opts.get("polymorphic"))) return;
          const list = args(m);
          // `add_reference :table, :name` names both; `t.references :name`
          // names the column and its block names the table.
          const table = added ? lit(list[0]) : columnBlockTable(m, mctx);
          const name = lit(list[added ? 1 : 0]);
          const fk = opts.get("foreign_key");
          const inline = fk !== undefined && !isFalse(fk);
          add({
            node: site(m),
            conforming: inline || declaredApart(keys, table, name),
            where: cls.name ?? null,
          });
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
