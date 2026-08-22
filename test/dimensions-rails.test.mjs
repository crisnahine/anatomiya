import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRuby } from "./ruby-available.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRuby } from "../lib/ruby.mjs";
import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";
import { applicabilityFloor, applyGates } from "../lib/reduce.mjs";
import { RAILS_DIMENSIONS } from "../lib/dimensions-rails.mjs";
import { RUBY_DECLINED } from "./declined-fixtures.mjs";

const dir = mkdtempSync(join(tmpdir(), "anatomiya-rails-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

function write(name, src) {
  const abs = join(dir, `${name}.rb`);
  writeFileSync(abs, src);
  return { rel: `${name}.rb`, abs };
}

/**
 * Every one of the six is scoped to an ActiveRecord::Migration subclass, so
 * every fixture that means to be counted carries one and every fixture that
 * means to be invisible carries something else. Fixtures sit at column zero:
 * a heredoc keeps its own indentation and one of these is about what the
 * string cap does to it.
 */
const SRC = {
  // `def self.up` is a def with receiver {t:"self"}. Four real files on the
  // measured repository are written this way.
  legacy_self_up: `
class Legacy < ActiveRecord::Migration[7.2]
  def self.up
    create_table :tags
  end

  def self.down
    drop_table :tags
  end
end
`,

  mixed_change_and_up: `
class Mixed < ActiveRecord::Migration[7.2]
  def change
    add_column :a, :b, :string
  end

  def up
    execute 'CREATE INDEX x ON a (b)'
  end
end
`,

  helper_only: `
class HelperOnly < ActiveRecord::Migration[7.2]
  def backfill_batch_size
    1000
  end
end
`,

  local_base: `
class Local < BaseMigration
  def change
    add_column :a, :b, :string, null: false
    create_table :c, id: :uuid do |t|
      t.references :d, foreign_key: true
    end
  end
end
`,

  opts_hash_splat: `
class Opts < ActiveRecord::Migration[7.2]
  def change
    create_table :t do |t|
      t.string :a, { null: false }
      t.string :b, **shared_opts
      t.string :c, null: true
    end
  end
end
`,

  opts_unreadable_key: `
class Unreadable < ActiveRecord::Migration[7.2]
  def change
    create_table :tags, key => false do |t|
      t.string :a, null: false
      t.string :b, key => false
      t.string :c, CONST => 1
      t.string :d, :"#{name}" => 1
    end
    add_reference :comments, :user, key => true
  end
end
`,

  named_block_param: `
class Named < ActiveRecord::Migration[7.2]
  def change
    create_table :things do |table|
      table.string :a, null: false
      table.timestamps
    end
    t.string :stray
  end
end
`,

  index_fresh_and_existing: `
class Both < ActiveRecord::Migration[7.2]
  disable_ddl_transaction!

  def change
    create_table :fresh do |t|
      t.string :name
    end
    add_index :fresh, :name
    add_index :existing, :other, algorithm: :concurrently
  end
end
`,

  index_no_ddl: `
class NoDdl < ActiveRecord::Migration[7.2]
  def change
    add_index :listings, :patent_pending, algorithm: :concurrently
  end
end
`,

  // The shape of a real db/schema.rb: no class, so nothing here is a site.
  schema_rb: `
ActiveRecord::Schema[7.2].define(version: 2026_08_09_064200) do
  create_table "addresses", id: :uuid, force: :cascade do |t|
    t.uuid "user_id"
    t.datetime "created_at", null: false
    t.index ["user_id"], name: "index_addresses_on_user_id"
  end

  add_foreign_key "signups", "users"
end
`,

  sql_update: `
class Sql < ActiveRecord::Migration[7.2]
  def up
    execute(<<~SQL.squish)
      UPDATE listings SET watched_count = 0
    SQL
  end
end
`,

  sql_ddl: `
class Ddl < ActiveRecord::Migration[7.2]
  def up
    execute 'CREATE INDEX CONCURRENTLY x ON y (z)'
  end
end
`,

  polymorphic_reference: `
class AddOwner < ActiveRecord::Migration[7.2]
  def change
    add_reference :comments, :owner, polymorphic: true
    create_table :notes do |t|
      t.references :subject, polymorphic: true
    end
    add_reference :posts, :author, foreign_key: true
  end
end
`,

  sidekiq_entry: `
class SendDigestWorker
  include Sidekiq::Worker

  def perform(id)
    raise Retryable if bad?(id)
  end
end
`,

  data_up_down: `
class UpdatePrompt < ActiveRecord::Migration[7.2]
  def up
    Prompt.find_by(key: 'past_seller').update!(body: 'new')
  end

  def down
    Prompt.find_by(key: 'past_seller').update!(body: 'old')
  end
end
`,

  three_step_null: `
class Backfill < ActiveRecord::Migration[7.2]
  def up
    add_column :users, :tier, :string
    User.in_batches.update_all(tier: 'free')
    change_column_null :users, :tier, false
  end

  def down
    remove_column :users, :tier
  end
end
`,

  change_table_column: `
class Alter < ActiveRecord::Migration[7.2]
  def change
    change_table :users do |t|
      t.string :nickname
    end
  end
end
`,

  bare_add_column: `
class Bare < ActiveRecord::Migration[7.2]
  def change
    add_column :users, :nickname, :string
  end
end
`,

  const_index_name: `
class Idx < ActiveRecord::Migration[7.2]
  INDEX_NAME = 'index_watched_listings_on_user_id_and_listing_id'

  def up
    remove_index :watched_listings, name: INDEX_NAME, if_exists: true
    add_index :watched_listings, %i[user_id listing_id], name: INDEX_NAME
  end
end
`,

  model_backfill: `
class Backfill < ActiveRecord::Migration[7.2]
  def up
    Listing.where(archived: true).update_all(archived_at: Time.current)
  end
end
`,

  // Verbatim from the two files in
  // /Users/crisn/Documents/Projects/chameleon-realusage-test/rails-blog/db/migrate,
  // copied in so the suite does not read a repository outside this one.
  blog_create_posts: `
class CreatePosts < ActiveRecord::Migration[8.1]
  def change
    create_table :posts do |t|
      t.string :title, null: false
      t.text :body
      t.boolean :published, default: false
      t.datetime :published_at
      t.references :user, null: false, foreign_key: true
      t.references :category, foreign_key: true

      t.timestamps
    end
  end
end
`,

  blog_create_articles: `
class CreateArticles < ActiveRecord::Migration[8.1]
  def change
    create_table :articles do |t|
      t.string :headline, null: false
      t.text :body
      t.boolean :published, default: false
      t.datetime :published_at
      t.references :user, null: false, foreign_key: true
      t.references :category, foreign_key: true

      t.timestamps
    end
  end
end
`,
  connection_dml: `
class Backfill < ActiveRecord::Migration[7.0]
  def change
    ActiveRecord::Base.connection.execute("UPDATE users SET flag = true")
  end
end
`,
  connection_ddl: `
class AddThing < ActiveRecord::Migration[7.0]
  def change
    ActiveRecord::Base.connection.execute("CREATE INDEX idx ON users (id)")
  end
end
`,

  // empire-flippers/api writes the constraint as its own statement beside the
  // reference, which is the form `add_reference ... foreign_key: true` spells
  // inline. Both declare the same foreign key.
  fk_separate_statement: `
class CreateTicketComments < ActiveRecord::Migration[6.1]
  def change
    add_reference :ticket_comments, :user, type: :uuid, index: true
    add_foreign_key :ticket_comments, :users, on_update: :cascade

    add_reference :ticket_comments, :ticket, type: :uuid, index: true
    add_foreign_key :ticket_comments, :tickets, on_update: :cascade
  end
end
`,
  // The constraint names a different table from the one the reference points
  // at, so it is not this reference's foreign key.
  fk_other_table: `
class AddOwner < ActiveRecord::Migration[6.1]
  def change
    add_reference :listings, :owner, type: :uuid
    add_foreign_key :listings, :categories
  end
end
`,
  // The constraint sits on another table entirely.
  fk_other_from: `
class AddOwnerElsewhere < ActiveRecord::Migration[6.1]
  def change
    add_reference :listings, :user, type: :uuid
    add_foreign_key :tasks, :users
  end
end
`,
  // `column:` names the reference outright, so no pluralisation is needed.
  fk_named_column: `
class AddSeller < ActiveRecord::Migration[6.1]
  def change
    add_reference :listings, :seller, type: :uuid
    add_foreign_key :listings, :users, column: :seller_id
  end
end
`,
  // A `t.references` inside the block the migration creates, answered by an
  // `add_foreign_key` on the same table below it.
  fk_inside_create_table: `
class CreateTasks < ActiveRecord::Migration[6.1]
  def change
    create_table :tasks, id: :uuid do |t|
      t.references :listing, type: :uuid
    end
    add_foreign_key :tasks, :listings
  end
end
`,

  // A key added only on the way down does not exist going forward, which is the
  // direction the column is added in.
  fk_only_on_rollback: `
class R1 < ActiveRecord::Migration[6.1]
  def change
    add_reference :listings, :user, type: :uuid
    reversible do |dir|
      dir.down { add_foreign_key :listings, :users }
    end
  end
end
`,
  fk_only_in_down: `
class R2 < ActiveRecord::Migration[6.1]
  def up
    add_reference :listings, :user, type: :uuid
  end

  def down
    add_foreign_key :listings, :users
  end
end
`,
  // `t.foreign_key` inside the block is the same declaration with a receiver.
  fk_inside_change_table: `
class R3 < ActiveRecord::Migration[6.1]
  def change
    change_table :tasks do |t|
      t.references :listing, type: :uuid
      t.foreign_key :listings, column: :listing_id
    end
  end
end
`,

  // The two pluralisations that are not a bare `s`: a consonant before `y`, and
  // a sibilant ending.
  fk_irregular_plurals: `
class R4 < ActiveRecord::Migration[6.1]
  def change
    add_reference :listings, :company, type: :uuid
    add_foreign_key :listings, :companies

    add_reference :listings, :address, type: :uuid
    add_foreign_key :listings, :addresses
  end
end
`,
  // `down` on some other receiver is somebody's method, not the rollback half
  // of a reversible block.
  fk_unrelated_down_block: `
class R5 < ActiveRecord::Migration[6.1]
  def change
    add_reference :listings, :user, type: :uuid
    Rollout.down do
      add_foreign_key :listings, :users
    end
  end
end
`,
};

const parsed = await parseRuby(Object.entries(SRC).map(([name, src]) => write(name, src)));
const programs = new Map(parsed.results.map((r) => [r.rel.replace(/\.rb$/, ""), r]));

const KEYS = [
  "migration_reversible",
  "migration_schema_only",
  "column_null_declared",
  "table_primary_key_declared",
  "reference_foreign_key",
];

function dim(key) {
  const d = RAILS_DIMENSIONS.find((x) => x.key === key);
  assert.ok(d, `no rails dimension named ${key}`);
  return d;
}

function hits(key, name) {
  const file = programs.get(name);
  assert.ok(file && file.ok, `${name} did not parse: ${file && file.error}`);
  const out = [];
  dim(key).run(file.program, (h) => out.push(h));
  return out;
}

function counts(key, ...names) {
  const all = names.flatMap((n) => hits(key, n));
  return { candidates: all.length, conforming: all.filter((h) => h.conforming).length };
}

test("every fixture parsed, through one child process", needsRuby, () => {
  assert.equal(parsed.results.length, Object.keys(SRC).length);
  assert.equal(parsed.crashed, 0);
  assert.equal(parsed.error, null);
});

/* --- migration_reversible --- */

test("a migration defining self.up and self.down is an up-down migration, not a class with no methods", needsRuby, () => {
  // prism gives `def self.up` a receiver of {t:"self"}. Reading only
  // receiverless defs classifies this class as defining no migration method,
  // drops it from the candidate set, and its violation vanishes: on the
  // measured repository that moves the stated ratio from 0.9212 up to 0.9236,
  // in the direction that states a convention off fewer violations.
  assert.deepEqual(counts("migration_reversible", "legacy_self_up"), {
    candidates: 1,
    conforming: 0,
  });
});

test("a class defining both change and up is a violation, not a conforming migration", needsRuby, () => {
  // A predicate written as `defs.has("change")` reports this as the good case.
  // It is a migration Rails cannot roll back; there are 3 on Empire Flippers
  // and 1 on Mastodon.
  assert.deepEqual(counts("migration_reversible", "mixed_change_and_up"), {
    candidates: 1,
    conforming: 0,
  });
});

test("a migration class defining none of change, up or down is not a candidate", needsRuby, () => {
  // A helper-only class has made no choice about reversibility, so counting it
  // as conforming pads the numerator with classes the claim is not about.
  assert.equal(hits("migration_reversible", "helper_only").length, 0);
});

test("change alone conforms, once per class rather than once per statement", needsRuby, () => {
  assert.deepEqual(counts("migration_reversible", "blog_create_posts", "blog_create_articles"), {
    candidates: 2,
    conforming: 2,
  });
});

/* --- migration_schema_only --- */

test("an execute is classified by its SQL verb, through a squiggly heredoc and a chained call", needsRuby, () => {
  // `<<~SQL.squish` parses as a call named squish whose receiver is the string,
  // so reading args[0] as a string node finds no SQL at all, calls the
  // migration schema-only, and states a data-hygiene convention over migrations
  // that rewrite rows.
  assert.deepEqual(counts("migration_schema_only", "sql_update"), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("migration_schema_only", "sql_ddl"), { candidates: 1, conforming: 1 });
});

test("a constant assigned in the migration is not an application model", needsRuby, () => {
  // Real pattern: INDEX_NAME is a constant_write in the class body and every
  // later use is a constant_read. Charging it as a data touch reports a pure
  // schema migration as a violation.
  assert.deepEqual(counts("migration_schema_only", "const_index_name"), {
    candidates: 1,
    conforming: 1,
  });
});

test("a migration reaching into a model is the violation the claim is about", needsRuby, () => {
  // Without this the previous test is satisfied by a predicate that never
  // charges a constant receiver at all. Time is on the framework allowlist and
  // Listing is not.
  assert.deepEqual(counts("migration_schema_only", "model_backfill"), {
    candidates: 1,
    conforming: 0,
  });
});

/* --- column_null_declared --- */

test("a brace hash is read and a double-splat drops the site", needsRuby, () => {
  // Two separate misreads, both pushing the ratio down so a repository that has
  // the convention is told it does not. Matching only `keyword_hash` misses
  // `{ null: false }`, which prism emits as a `hash`. Iterating assoc elements
  // without checking for `assoc_splat` reads `**shared_opts` as an empty option
  // set and charges an unknowable column as a violation.
  assert.deepEqual(counts("column_null_declared", "opts_hash_splat"), {
    candidates: 2,
    conforming: 1,
  });
});

test("a key this tool cannot read makes the whole options list unreadable", needsRuby, () => {
  // A dynamic key, a constant and an interpolated symbol all say the same thing
  // a ** splat says: the option set cannot be read. Skipping the entry and
  // keeping the rest reads a column that may well declare `null: false` as one
  // that declared nothing, and `check` grades against that invented violation.
  assert.deepEqual(counts("column_null_declared", "opts_unreadable_key"), {
    candidates: 1,
    conforming: 1,
  });
  assert.deepEqual(counts("table_primary_key_declared", "opts_unreadable_key"), {
    candidates: 0,
    conforming: 0,
  });
  assert.deepEqual(counts("reference_foreign_key", "opts_unreadable_key"), {
    candidates: 0,
    conforming: 0,
  });
});

test("the column block parameter is read from the block, not assumed to be named t", needsRuby, () => {
  // Hard-coding the receiver name to `t` drops every create_table written with
  // another block parameter. Accepting any receiver named like a block
  // parameter counts the stray call outside the table block. t.timestamps is
  // not a column the writer chose the nullability of.
  assert.deepEqual(counts("column_null_declared", "named_block_param"), {
    candidates: 1,
    conforming: 1,
  });
});

/* --- table_primary_key_declared --- */

test("create_table without an id option does not declare its primary key", needsRuby, () => {
  // The Rails default is bigint, so a repository on uuid keys has a rule an
  // agent gets wrong on its first new table, and the default is the opposite
  // rule. 0.9869 on Empire Flippers against 0.0165 on Mastodon.
  assert.deepEqual(counts("table_primary_key_declared", "named_block_param"), {
    candidates: 1,
    conforming: 0,
  });
});

/* --- reference_foreign_key --- */

test("t.references carrying foreign_key conforms, counted per reference not per table", needsRuby, () => {
  assert.deepEqual(counts("reference_foreign_key", "blog_create_posts", "blog_create_articles"), {
    candidates: 4,
    conforming: 4,
  });
});

/* --- what is out of scope for all six --- */

test("a class inheriting from a repository-local base contributes nothing to any of the six", needsRuby, () => {
  // Keying applicability on `def change` rather than on the superclass would
  // make every service object with a method named change a migration
  // candidate. It also pins the known under-count that makes all six partial:
  // a repository whose migrations inherit a local base is invisible to them.
  for (const key of KEYS) assert.equal(hits(key, "local_base").length, 0, key);
});

test("schema.rb contributes nothing to any of the six", needsRuby, () => {
  // The real db/schema.rb holds 146 create_table calls, 2,570 column
  // declarations and 870 index calls in one file. Matching bare call names
  // without an enclosing migration class folds all of it into one area, where
  // effectiveFiles is 1 against a concentration gate of 3, and suppresses the
  // whole dimension while looking like a huge population.
  for (const key of KEYS) assert.equal(hits(key, "schema_rb").length, 0, key);
});

/* --- the gates these counts have to pass through --- */

test("the real Empire Flippers reversible and primary-key counts both state a directive", needsRuby, () => {
  // db/migrate is one directory, so the directory gate is skipped. The claim
  // survives down to 1,393 conforming before the bound falls under 0.90, which
  // is 9 more violations than it carries.
  const reversible = applyGates(
    {
      key: "migration_reversible",
      candidates: 1522,
      conforming: 1402,
      applicability: 1522,
      langFileCount: 1522,
      effectiveFiles: 1522,
      top: { candidates: 1, conforming: 1 },
      files: ["db/migrate/a.rb"],
    },
    { authors: 5, repoAuthors: 13, areaFileCount: 1522, areaDirCount: 1 }
  );
  assert.equal(reversible.directive, true);
  assert.equal(reversible.gate, null);
  assert.equal(Number(reversible.bound.toFixed(4)), 0.9065);

  // A 0.9869 convention on a real repository, and the strongest untold claim in
  // that map: the quarter share asked 381 of a single 1,522-file directory, so
  // any construct rarer than a quarter of a big flat area was unstateable
  // however perfect. Capped at three roots the floor asks 120 and this states.
  const primaryKey = applyGates(
    {
      key: "table_primary_key_declared",
      candidates: 153,
      conforming: 151,
      applicability: 137,
      langFileCount: 1522,
      effectiveFiles: 120,
      top: { candidates: 4, conforming: 4 },
      files: ["db/migrate/a.rb"],
    },
    { authors: 5, repoAuthors: 13, areaFileCount: 1522, areaDirCount: 1 }
  );
  assert.equal(primaryKey.gate, null);
  assert.equal(primaryKey.directive, true);
  assert.equal(Number(primaryKey.ratio.toFixed(4)), 0.9869);
  assert.equal(Number(primaryKey.bound.toFixed(4)), 0.9536);
  // It is `partial`, so whatever it states is capped at FIX and can never
  // reach the severity that means "the first violation in this area's history".
  assert.equal(applicabilityFloor(1522), 120);
});

test("a two-migration repository states nothing from a perfect record", needsRuby, () => {
  // A young Rails app is exactly where the generator default makes every
  // migration look identical, so a candidate floor below 35 sites would have
  // the tool read its own generator back to itself.
  const blog = (o) =>
    applyGates(
      { key: "k", applicability: 2, langFileCount: 2, files: ["db/migrate/a.rb", "db/migrate/b.rb"], ...o },
      { authors: 1, repoAuthors: 1, areaFileCount: 2, areaDirCount: 1 }
    );

  const reversible = blog({
    candidates: 2, conforming: 2, effectiveFiles: 2, top: { candidates: 1, conforming: 1 },
  });
  assert.equal(reversible.ratio, 1);
  assert.equal(reversible.directive, false);
  assert.equal(reversible.gate, "evidence");

  const foreignKey = blog({
    candidates: 4, conforming: 4, effectiveFiles: 2, top: { candidates: 2, conforming: 2 },
  });
  assert.equal(foreignKey.ratio, 1);
  assert.equal(foreignKey.directive, false);
  assert.equal(foreignKey.gate, "evidence");
});

/* --- the shape the reducer and the check rely on --- */

test("the six rails dimensions ship, reachable from the one registry", needsRuby, () => {
  // A dimension the registry cannot see is counted nowhere, whichever file
  // defines it.
  assert.deepEqual(RAILS_DIMENSIONS.map((d) => d.key).sort(), [...KEYS].sort());
  for (const key of KEYS) {
    assert.ok(ALL_DIMENSIONS.some((d) => d.key === key), `${key} is not in ALL_DIMENSIONS`);
  }
});

test("every rails dimension declares its precision and its language", needsRuby, () => {
  for (const d of RAILS_DIMENSIONS) {
    assert.ok(["precise", "partial"].includes(d.precision), d.key);
    assert.deepEqual(d.langs, ["ruby"], d.key);
    assert.ok(d.claim && d.claim.length > 10, `${d.key} needs a readable claim`);
  }
});

test("a rails dimension only ever calls add with what the reducer reads", needsRuby, () => {
  for (const d of RAILS_DIMENSIONS) {
    let fired = 0;
    for (const name of programs.keys()) {
      d.run(programs.get(name).program, (h) => {
        fired++;
        const at = `${d.key} on ${name}`;
        assert.equal(typeof h.conforming, "boolean", at);
        assert.ok(h.where === null || typeof h.where === "string", at);
        // check.mjs destructures hit.node on every hit and reads type, name and
        // line off it. A hit without one throws there, not here.
        assert.ok(h.node && typeof h.node === "object", `${at} emitted no node`);
        assert.equal(typeof h.node.type, "string", at);
        assert.ok(h.node.name === null || typeof h.node.name === "string", at);
        assert.ok(typeof h.node.line === "number" && h.node.line > 0, at);
        // B5: an offset here would be a UTF-8 byte count handed to a slice of a
        // UTF-16 string.
        assert.notEqual(typeof h.node.start, "number", at);
        assert.notEqual(typeof h.node.end, "number", at);
      });
    }
    assert.ok(fired > 0, `${d.key} never fired, so no fixture holds it to this shape`);
  }
});

test("SQL through a connection receiver is data work, not schema work", needsRuby, () => {
  // Only a receiverless `execute` was SQL-checked, and the framework whitelist
  // swallowed the receiver, so neither arm looked at this. A migration that
  // rewrites rows this way and names no model constant was stated as leaving
  // the data alone. Four real migrations use the shape.
  const dml = hits("migration_schema_only", "connection_dml");
  assert.equal(dml.length, 1);
  assert.equal(dml[0].conforming, false, "an UPDATE is data work whoever it is sent to");

  const ddl = hits("migration_schema_only", "connection_ddl");
  assert.equal(ddl.length, 1);
  assert.equal(ddl[0].conforming, true, "DDL through the same receiver is still schema work");
});

/* --- a row does not ask a question another row already answered no to (#62) --- */

test("a data migration is not a candidate for the reversibility row", needsRuby, () => {
  // Rails' `change` auto-inverts only a closed set of schema commands, and
  // `row.update!(...)` is not one of them: collapsing up/down into change
  // either lies, because rollback re-runs the update forward and reports
  // success, or raises ActiveRecord::IrreversibleMigration. 88 of that
  // repository's 121 reversibility violations sat on a migration the
  // schema-only row also flags.
  assert.deepEqual(hits("migration_reversible", "data_up_down"), []);
  assert.deepEqual(counts("migration_schema_only", "data_up_down"), { candidates: 1, conforming: 0 });
});

test("raw SQL nobody could read is where up and down is the correct form", needsRuby, () => {
  // An `execute` whose string the cap truncated is raw SQL, and raw SQL is
  // exactly where `change` cannot invert. The schema-only row already declines
  // to judge it; the reversibility row now declines with it.
  assert.deepEqual(hits("migration_reversible", "sql_update"), []);
  assert.deepEqual(counts("migration_reversible", "sql_ddl"), { candidates: 1, conforming: 0 });
});

test("the only form that runs on a populated table is not judged by three rows at once", needsRuby, () => {
  // add nullable, backfill, then change_column_null, in up/down. It was a
  // violation of all three rows and the only one of the three forms that runs.
  assert.deepEqual(hits("migration_reversible", "three_step_null"), []);
  assert.deepEqual(hits("column_null_declared", "three_step_null"), []);
  assert.deepEqual(counts("migration_schema_only", "three_step_null"), { candidates: 1, conforming: 0 });
});

test("column_null_declared asks only about columns on a table the migration creates", needsRuby, () => {
  // On a populated table `add_column ... null: false` raises
  // PG::NotNullViolation without a default, so asking for it is asking for a
  // migration that does not run.
  assert.deepEqual(counts("column_null_declared", "named_block_param"), { candidates: 1, conforming: 1 });
  assert.deepEqual(hits("column_null_declared", "change_table_column"), []);
  assert.deepEqual(hits("column_null_declared", "bare_add_column"), []);
});

test("a polymorphic reference cannot declare a foreign key, so it is not a site", needsRuby, () => {
  // ActiveRecord itself raises `ArgumentError: Cannot add a foreign key to a
  // polymorphic relation`, so the conforming form does not run.
  assert.deepEqual(counts("reference_foreign_key", "polymorphic_reference"), { candidates: 1, conforming: 1 });
});

test("a foreign key declared as its own statement is this reference's foreign key", needsRuby, () => {
  // empire-flippers/api: 167 `add_foreign_key` statements against 12 inline
  // options. Read as the inline option only, a reference the migration does
  // constrain read as a violation.
  assert.deepEqual(counts("reference_foreign_key", "fk_separate_statement"), {
    candidates: 2,
    conforming: 2,
  });
  assert.deepEqual(counts("reference_foreign_key", "fk_named_column"), { candidates: 1, conforming: 1 });
  assert.deepEqual(counts("reference_foreign_key", "fk_inside_create_table"), { candidates: 1, conforming: 1 });
});

test("a foreign key on another table or another column is not this reference's", needsRuby, () => {
  assert.deepEqual(counts("reference_foreign_key", "fk_other_table"), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("reference_foreign_key", "fk_other_from"), { candidates: 1, conforming: 0 });
});

test("a foreign key that only exists on the way down is not this reference's", needsRuby, () => {
  // The column is added going forward and the constraint is not, so forward the
  // reference has no key at all.
  assert.deepEqual(counts("reference_foreign_key", "fk_only_on_rollback"), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("reference_foreign_key", "fk_only_in_down"), { candidates: 1, conforming: 0 });
});

test("a foreign key declared on the table block counts like the standalone call", needsRuby, () => {
  assert.deepEqual(counts("reference_foreign_key", "fk_inside_change_table"), { candidates: 1, conforming: 1 });
});

test("a reference pluralises to the table its key names", needsRuby, () => {
  // `company` owes `companies` and `address` owes `addresses`; read as a bare
  // `s` neither key would be matched to the column it covers.
  assert.deepEqual(counts("reference_foreign_key", "fk_irregular_plurals"), { candidates: 2, conforming: 2 });
});

test("a block named down on another receiver is not the rollback half", needsRuby, () => {
  assert.deepEqual(counts("reference_foreign_key", "fk_unrelated_down_block"), { candidates: 1, conforming: 1 });
});

/* --- the two Rails clauses, run rather than read (#97) --- */

// Their exclusion lands per call inside a class that keeps contributing other
// sites, so a `create_table` block can hold four counted columns and one that
// was dropped, all under a perfect claim in a file the claim credits. That is
// what earns them a line where the two migration-wide rows get none: a class
// declined whole never enters the count, and `N of N sites across X of Y files`
// already says a file went uncounted.
const declinedFiles = Object.entries(RUBY_DECLINED).flatMap(([key, { declined, counted }]) =>
  [...Object.entries(declined), ...Object.entries(counted)].map(([name, body]) => ({
    key,
    name,
    src: `class ${name.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())} < ActiveRecord::Migration[7.2]\n  ${body}\nend\n`,
  }))
);

const declinedParsed = await parseRuby(declinedFiles.map(({ name, src }) => write(name, src)));
const declinedPrograms = new Map(declinedParsed.results.map((r) => [r.rel.replace(/\.rb$/, ""), r]));

function declinedSites(key, name) {
  const file = declinedPrograms.get(name);
  assert.ok(file && file.ok, `${name} did not parse: ${file && file.error}`);
  let n = 0;
  dim(key).run(file.program, () => n++);
  return n;
}

for (const [key, { declined, counted }] of Object.entries(RUBY_DECLINED)) {
  test(`${key} counts none of what its clause says it declines`, needsRuby, () => {
    for (const name of Object.keys(declined)) {
      assert.equal(declinedSites(key, name), 0, `${key} counted a site in ${name}`);
    }
    for (const name of Object.keys(counted)) {
      assert.ok(declinedSites(key, name) > 0, `${key} counted nothing in ${name}`);
    }
  });
}
