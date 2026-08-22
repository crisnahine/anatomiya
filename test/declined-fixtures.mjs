/**
 * What each `applicabilityPredicate.notCounted` clause claims, as something that
 * can be run.
 *
 * The clause is prose and prose cannot be asserted, so this asserts the thing the
 * prose describes: every shape the clause names produces no site, and one shape
 * the row does count produces at least one, which is what stops a fixture
 * passing because nothing parsed. A clause written off the `sites` prose and
 * never run against the predicate was wrong or partial far more often than not.
 *
 * Apart from either test file because three parsers answer for these rows and
 * one of them may be absent. `test/dimensions.test.mjs` runs the JS and the
 * path-only rows and holds every clause to having an entry here at all;
 * `test/dimensions-rails.test.mjs` runs the Ruby ones and skips where prism is.
 * The coverage check has to run either way, or a row could grow a clause on a
 * machine with no Ruby and nothing would ask for its fixture.
 */

/** Rows oxc answers for. `rel` is read only by the three routing rows. */
export const JS_DECLINED = {
  optional_chaining: {
    // The computed read is the arm a first pass missed: `config["KEY"]` is a read
    // off a listed name, declined, and `config?.["KEY"]` is a legal conforming
    // form, so it is an exclusion rather than a population the row never had.
    declined: ["options.a = 1;", "new options.a();", "options.a++;", "[options.a] = z;", 'const z = options["a"];'],
    counted: "const z = options.a;",
  },
  non_null_assertion: {
    declined: ["const y = x!;", "x!.a = 1;", "new x!();", "x!`t`;"],
    counted: "const z = x!.a;",
  },
  nullish_default: {
    declined: ["const x = a || b || 1;", "const x = a && b || 1;"],
    counted: "const x = a || 1;",
  },
  import_extension: {
    // `./utils` is counted and non-conforming: it names a file and omits the
    // extension. Only `.`, `..` and a trailing slash are the directory case,
    // which is why the clause spells them out.
    declined: ['import a from "./a.css";', 'import a from ".";', 'import a from "./dir/";'],
    counted: 'import a from "./utils";',
  },
  extends_base: {
    declined: ["class A {}", "class A extends mixin(B) {}", "class A extends null {}", "class A extends this.B {}"],
    counted: "class A extends B {}",
  },
  spread_on_component: {
    // Onto a host element only. The same spread onto a component is counted, and
    // dropping that condition is what made the clause false the first time.
    declined: ["function C({ a, ...rest }) { return <div {...rest} />; }"],
    counted: "function C({ a, ...rest }) { return <Foo {...rest} />; }",
  },
  route_logging: {
    declined: [
      { src: 'import logger from "./logger.js"; console.log("a"); logger.info("b");', rel: "src/logger.js" },
      { src: 'import logger from "./logger.js"; console.log("a"); logger.info("b");', rel: "src/log.util.js" },
    ],
    counted: { src: 'import logger from "./logger.js"; console.log("a"); logger.info("b");', rel: "src/app_logger.js" },
  },
  route_network: {
    declined: [
      { src: 'import axios from "axios"; fetch("/a"); axios.get("/b");', rel: "src/api-client.js" },
      { src: 'import axios from "axios"; fetch("/a"); axios.get("/b");', rel: "src/http.js" },
    ],
    counted: { src: 'import axios from "axios"; fetch("/a"); axios.get("/b");', rel: "src/userApi.js" },
  },
  route_env: {
    declined: [
      { src: "const a = process.env.PORT;", rel: "src/config.js" },
      { src: "const a = process.env.PORT;", rel: "src/env.settings.js" },
    ],
    counted: { src: "const a = process.env.PORT;", rel: "src/appConfig.js" },
  },
};

/**
 * The nine companion rows, which read a path and never a tree. One entry, since
 * they share a mechanism and a clause: the noun follows each row's own root.
 */
export const PATH_DECLINED = {
  declined: ({ from, ext, companionSuffix }) => {
    const noun = from.split("/").pop().replace(/s$/, "");
    return [
      `${from}/base${ext}`,
      `${from}/base_${noun}${ext}`,
      `${from}/concerns/base${ext}`,
      `${from}/thing${companionSuffix}`,
    ];
  },
  counted: ({ from, ext }) => `${from}/user${ext}`,
};

/** Rows prism answers for, as whole migration classes. */
export const RUBY_DECLINED = {
  column_null_declared: {
    declined: {
      cn_splat: "def change\n    create_table :tags do |t|\n      t.string :name, **opts\n    end\n  end",
      cn_brace_splat: "def change\n    create_table :tags do |t|\n      t.string :name, { **defaults }\n    end\n  end",
      cn_dynamic_key: "def change\n    create_table :tags do |t|\n      t.string :name, key => false\n    end\n  end",
      cn_undecided_null:
        "def change\n    create_table :tags do |t|\n      t.string :name, null: nullable\n    end\n  end",
    },
    counted: {
      cn_declared: "def change\n    create_table :tags do |t|\n      t.string :name, null: false\n    end\n  end",
    },
  },
  reference_foreign_key: {
    declined: {
      rf_polymorphic: "def change\n    add_reference :comments, :subject, polymorphic: true\n  end",
      rf_splat: "def change\n    add_reference :comments, :user, **opts\n  end",
      rf_dynamic_key: "def change\n    add_reference :comments, :user, key => true\n  end",
      rf_key_apart_unreadable:
        "def change\n    add_reference :comments, :user\n    add_foreign_key :comments, :users, key => 1\n  end",
      rf_key_on_a_table_it_cannot_read:
        "def change\n    add_reference :comments, :user\n    add_foreign_key table, :users, column: \"user_id\"\n  end",
      rf_reference_table_unreadable:
        "def change\n    create_table table_name do |t|\n      t.references :user\n    end\n    add_foreign_key :comments, :users, column: \"user_id\"\n  end",
      rf_reference_name_unreadable:
        "def change\n    add_reference :comments, ref_name\n    add_foreign_key :comments, :users\n  end",
      rf_undecided_foreign_key: "def change\n    add_reference :comments, :user, foreign_key: fk_options\n  end",
      rf_polymorphic_written_as_a_list: "def change\n    add_reference :comments, :subject, polymorphic: %i[post note]\n  end",
    },
    counted: {
      rf_declared: "def change\n    add_reference :comments, :user, foreign_key: true\n  end",
    },
  },
};
