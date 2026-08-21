# Dimension intake

Every dimension this tool ships, and every glossary entry that will never become one, in one table.

A glossary entry is not a dimension. Three things have to happen to an entry before it can be one, and
this table is where each of them is recorded rather than decided again later:

- **Collapse.** Several entries often name one construct. Postel's Law, Fail fast and Input validation
  are three rows over one boundary-validation walk, and shipping them as three would print the same
  three numbers three times under three names, and inflate every coverage count taken from the result.
  The `absorbs` column carries every entry a key answers. (G2)
- **Rename.** A glossary name is a name for a principle. Rendered beside a ratio it reads as a verdict:
  `1.0` next to "Postel's Law" reads as a philosophical endorsement rather than a measurement. The
  `renamed from` column carries the glossary name, and the `key` carries what the map actually says.
  The rule is a load-time throw in `lib/dimensions.mjs`, not a convention. (G3)
- **Drop.** An entry with no writable denominator is not a counted claim, however visible it is. OWASP
  Top 10 is a findings list and a taxonomy over other rows; there is no set of sites to count it over.
  Dropped rows stay in this table with their reason, so nobody proposes them again. (G4)

A row here is not a promise to build. It is a decision about what the row would be if it were built.
The bar in `CONTRIBUTING.md` still has to be cleared before a `planned` row becomes `shipped`.

`absorbs` is `-` where a row was written from the codebase rather than from the glossary. That is a
legitimate origin and the table says so rather than inventing an entry to point at.

| key | absorbs | renamed from | status | why |
|---|---|---|---|---|
| swallowed_error | Error swallowing | - | shipped | |
| error_shape | Errors as values | - | shipped | |
| module_state_const | Immutable bindings | - | shipped | |
| async_error_handling | Unhandled promise rejection | - | shipped | |
| optional_chaining | Null safety | - | shipped | Counts a member read off six receiver names, which is the only optionality signal this tier has and a poor one: a measured 2,485-file repository writes `?.` 2,627 times across 672 files while the row sees 538 sites in 202. Answering it properly needs the checker, which knows whether a receiver's type includes null. |
| function_style | - | - | shipped | |
| explicit_return_type | Explicit public API types | - | shipped | |
| type_only_import | - | - | shipped | |
| import_extension | - | - | shipped | |
| nullish_default | - | - | shipped | |
| non_null_assertion | - | - | shipped | |
| absent_is_null | Null vs undefined | - | shipped | |
| iterate_with_for_of | - | - | shipped | |
| test_call_style | - | - | shipped | |
| assertion_style | - | - | shipped | |
| rescue_uses_error | Error swallowing (Ruby) | - | shipped | |
| hook_per_module | - | - | shipped | Measured across seven repositories before it shipped, counting a hook by name so an overload set is one: 0.9800 empire-flippers/client, 0.9429 backstage, 0.9367 cal.diy, 0.9259 next.js, 0.9224 supabase, 0.8235 storybook, 0.7778 react. Spread 0.2022 and two repositories under the gate, so it is a habit rather than a language default. |
| record_lookup | Exception-driven control flow | - | shipped | The axis is what a miss does, not which name was typed: `find_by` answers nil and the caller decides, while `find` and `find_by!` both raise. `find_by!` is `where(...).take!` in ActiveRecord's own source, so counting it as conforming would put it in the numerator of both sides at once. |
| model_callbacks | Fat model / callback soup | - | shipped | Moving a `before_save` verbatim into a concern flips the site to conforming with the behaviour unchanged, so the row rewards a relocation. Closing it needs cross-file resolution: which module a class includes, then that module's `included do` block. The row is partial and its blind field already says a concern can register callbacks from a file this one never names. |
| service_result_shape | Result objects | - | shipped | |
| keyword_params | Boolean trap; positional argument overload | - | shipped | Two entries over one signature walk: both are answered by whether the arguments are named |
| zone_aware_time | Time zone correctness | - | shipped | |
| hook_call_style | - | - | shipped | |
| handler_is_named | - | - | shipped | |
| spread_on_component | Prop drilling | - | shipped | |
| text_translated | Internationalisation | - | shipped | |
| handler_memoised | Referential stability | - | shipped | |
| migration_reversible | Reversible migration | - | shipped | |
| migration_schema_only | Schema and data migrations are separate | - | shipped | |
| column_null_declared | Database constraints over application validation | - | shipped | |
| table_primary_key_declared | - | - | shipped | |
| reference_foreign_key | Referential integrity | - | shipped | |
| rake_task_spec | Test coverage | Test coverage | shipped | The glossary's coverage entry is a runtime artifact and is not in a repository. What is here is whether a source file has a spec beside it, which is a different and honest claim, and the pairing obligations already answer it. Renamed because a coverage percentage is not what this counts |
| model_spec | - | - | shipped | |
| service_spec | - | - | shipped | |
| job_spec | - | - | shipped | |
| worker_spec | - | - | shipped | Reads 0 of 125 at `app/workers/workers` and 0 in all 22 worker areas: a convention the repository holds at 100% that the map cannot state, because `ratio` suppresses the forward side and a pairing row may not carry a counter. The inverse would read "a worker ships without a spec", which as a directive tells an agent to write one test fewer. Each area carries the fact twice instead, on the kinds line and on the suppressed count line. |
| controller_spec | - | - | shipped | |
| serializer_spec | - | - | shipped | |
| model_test | - | - | shipped | |
| job_test | - | - | shipped | |
| law_of_demeter | Law of Demeter | Law of Demeter | shipped | The glossary name is the principle's, and a ratio beside it reads as agreement with the principle rather than as a count of this repository's chains. The key says what is counted: a call chain whose receivers are one type. The only semantic row, so it reaches a scan only with --deep |
| file_naming_case | - | - | shipped | Written from the measured naming-divergence literature rather than the glossary. The class is learned per area from the plurality of its own filenames, a tie learns nothing, and a class that moved since the pin closes the slot |
| route_logging | - | - | shipped | The most cited agent symptom is framework-default code instead of the repository's wrapper. The wrapper is learned per file from relative imports whose filename says log, logger or logging; the spec also matched the imported binding name and that half was dropped, because a vocabulary-named binding out of an unrelated module is noise the filename is not. Offered only where at least three files already route through one (C14) |
| route_network | - | - | shipped | Same shape over fetch and axios against a client, http, api, request or fetcher module, under the same C14 offering. The spec's node:http direct form was dropped: request-shaped calls on it are rare in app code and the partial mark carries the blindness |
| route_env | - | - | shipped | Same shape over process.env, destructuring included, against a config, env or settings module, under the same C14 offering |
| logger_over_puts | - | - | shipped | The Ruby side of route_logging, under its own key because one key is one predicate and the two engines read different trees. puts, print, p, pp and warn with no receiver, in any position rather than statement position only, because prism reports no such distinction cheaply and the partial mark carries the cost; print rides along because it is the same stdout habit. Offered only where the repository has adopted a wrapper (C14) |
| http_through_client | - | - | shipped | The Ruby side of route_network, keyed apart for the same reason: Net::HTTP and URI.open against a constant or variable named in the client vocabulary |
| doc_comment_style | - | - | shipped | Written from the measured comment-divergence literature. Two real sides: repositories that document their export surface, and repositories whose files carry almost no comments, where the counter is the directive that stops tutorial-style over-commenting |
| function_naming_case | - | - | shipped | The same learning over module-level function names. Module level only, matching function_style's altitude: a method answers to its class's convention |
| exported_symbol_case | - | - | shipped | The same learning over an exported function or a non-class variable's name. Once ran over a module's whole export surface together; split into this row and exported_class_case and exported_type_case because JavaScript and TypeScript hold classes, interfaces, types and enums to a PascalCase convention that a directory of nothing but functions and constants never voted on |
| exported_class_case | - | - | shipped | Keyed apart from exported_symbol_case: an exported class follows PascalCase where an exported function or constant follows camelCase, and unlike exported_type_case it survives a Flow retry with its name intact |
| exported_type_case | - | - | shipped | Keyed apart from exported_symbol_case for the same reason as exported_class_case. The learning over an exported interface, type alias or enum's name. Blind on a Flow-stripped file, because the retry deletes the whole declaration |
| extends_base | - | - | shipped | The learning over the superclass a class names, which is the base a new file in this directory is expected to extend. The class is repository text rather than one of a closed set, so it is encoded into the sentence before it is rendered |
| class_base | - | - | shipped | The Ruby side of extends_base. Two keys rather than one, because a row carries one run and each engine hands it its own tree |
| module_include | - | - | shipped | The plurality module a class or module body includes. Directly in the body: a call inside a method runs when the method does and is not a mixin the body declares. The site is the body, counted once however many constants it includes: a Rails worker mixes in `Sidekiq::Worker` and one more module, so per constant the row sits under 0.5 whatever the directory does (H14). A class body that includes nothing is a site too, which is where the forgotten include is caught; a module including nothing is namespacing, a subclass may be handed the mixin by its base, a class inside a class is that class's helper, a body that prepends or extends a constant declared one by another route, and a reopening declares its mixins in the part that carries them, so none of those is one (H16) |
| interface_prefix | - | - | shipped | The learning over declared interface names, where none is a class in its own right and the model default, so a repository that prefixes nothing prints counts and a prefixed one states. `@typescript-eslint/naming-convention` can enforce the prefix, and the row is offered because most repositories do not configure it: across the 35-repository corpus it states on 14 areas of vscode and 6 of empire-flippers/client and nowhere else |
| type_alias_prefix | - | - | shipped | The same learning over type aliases. Keyed apart from interface_prefix because a repository can prefix one and not the other |
| boundary_input_validation | Postel's Law; Fail fast; Input validation | Postel's Law | planned | Three entries over one walk: the entry points that read request input. The input-validation predicate is the sharp one and the other two reference it. Renamed because a ratio next to a principle's name reads as an endorsement |
| observability | Observability; Metrics vs logs vs traces | - | planned | Metrics-vs-logs-vs-traces is a vocabulary distinction over the same sites, not a second detector |
| constructor_injection | Dependency injection / IoC; DI container (degraded half) | - | planned | The container entry's degraded half is the constructor-injection claim. Two keys share one pass: this one, and di_container_presence for the roster |
| di_container_presence | DI container (roster half) | - | planned | A presence roster with a degenerate ratio. Split from constructor_injection so the report can say which half produced the line |
| authz_check | Authentication vs authorization; Principle of least privilege | - | planned | The same before_action and policy-call walk. The least-privilege entry adds no sites of its own |
| iam_wildcard | Least privilege / zero trust | Least privilege / zero trust | planned | Only the IAM slice is countable, and tiering the whole entry on that slice would repeat the first matrix's optimism. The name says which slice |
| idempotency_key | Idempotency key | - | planned | One applicability pass shared with idempotent_operation: the token and the operation shape are different conforming rules over the same sites |
| idempotent_operation | Idempotent | - | planned | See idempotency_key |
| quarantine_rate | Flaky test | Flaky test | planned | Flakiness history lives in a CI provider's API. What the repository holds is the share of tests marked skipped or quarantined. Leaving the glossary name on it makes the map claim what it cannot know |
| - | OWASP Top 10 | - | dropped | A findings list and a taxonomy over other rows. There is no set of sites to count it over, so there is no ratio to state |
| - | Test coverage percentage | - | dropped | A runtime artifact. Present only if a coverage report is committed, and then it is a number somebody else measured |
| - | Flaky-test history | - | dropped | A CI provider's API. The repository holds the quarantine rate instead, which is the quarantine_rate row |
| - | Branch protection | - | dropped | Forge API state, not repository content |
| - | Required reviewers | - | dropped | Forge API state, not repository content |
| - | Required status checks | - | dropped | Forge API state, not repository content |
| - | Mean time to recovery | - | dropped | An incident record. Nothing in a repository counts it |
| - | Deployment frequency | - | dropped | A deploy log. Nothing in a repository counts it |
| - | Change failure rate | - | dropped | An incident record joined to a deploy log, neither of which is repository content |
| - | Lead time for changes | - | dropped | Derivable from commit dates only for merged work, and the denominator would be every change that never merged, which is not there |
| - | Bus factor | - | dropped | An authorship distribution, not a set of sites. The author gate already reads authorship, and it gates a claim rather than being one |
| - | Technical debt ratio | - | dropped | A scalar from a commercial analyser's own model. There is no denominator here that anyone else would compute the same way |
| - | Cyclomatic complexity threshold | - | dropped | Countable, but the claim would be a threshold somebody picked rather than a convention the repository shows. A ratio against an arbitrary cut is not evidence of a habit |
| - | Code review turnaround | - | dropped | Forge API state |
| - | Documentation freshness | - | dropped | Requires knowing what the documentation describes. There is no site to count |
| - | Dependency currency | - | dropped | A lockfile against a registry over the network. The scan reads no network (F-tier) |
| - | Secret scanning findings | - | dropped | A findings list, and one whose denominator is every string in the repository. The same objection as OWASP Top 10 |
| route_query | Data-fetch routing | - | planned | Proposed as a row that would clear the gates today; measured, it does not. 92 of 96 sites repo-wide is a Wilson lower bound of 0.8977, three conforming sites short of the 0.90 bar, and the gates run per area rather than repo-wide, so eight directories of about twelve sites each each need their own bound. Re-measure per area before building. |
| expectation_named | - | - | dropped | Ranked first in the proposal and refused by the spread bar. Measured over seven Ruby repositories: 0.9883 discourse, 0.9834 diaspora, 0.9754 openfoodnetwork, 0.9533 rubocop, 0.9446 empire-flippers/api, 0.9316 mastodon, 0.9003 forem. Spread 0.088 and nothing under the gate, so naming the argument is what everybody already does and the row would state a directive nobody could break. |
| comment_ticket_free | - | - | dropped | 8 violations in about 8,000 comments on the one repository measured, ratio 0.999, and no second repository below the gate. That is the `module_state_const` shape the acceptance bar was written for: a claim that scores 1.0 everywhere teaches nothing and spends an always-loaded line saying so. |
| eslint_disable_live | - | - | dropped | Would have to read the repository's eslint config, which no row can reach: a tree row is handed comments and source, a corpus row a basename, and there is no repository-fact channel for a config file. It is also `eslint --report-unused-disable-directives`, which the map does not restate. |
| mutation_error_quiet | - | - | dropped | 92 of 97 is a bound of 0.8850, under the gate. The conforming side would also need a notify vocabulary read off one repository's own helper names, with no learning behind it, which is a closed table that is wrong on the next repository. |
| date_through_wrapper | - | - | dropped | 243 of 269 is a ratio of 0.9033 and a bound of 0.8621. At that ratio the bound needs about 31,000 sites to clear 0.90, so it cannot state at any realistic area size. |
| schema_matches_migrations | Schema drift | - | planned | The highest-value row in the proposal and the one that does not fit: `db/schema.rb` changes only what this branch's migrations produce is a branch invariant rather than a ratio over sites, so it needs a fourth kind beside tree, corpus and pairing, and a reader in the check. Three of its four measured hits are on one pull request whose head would have shipped a schema dropping two columns that exist in production. |
| svg_in_asset | - | - | dropped | The proposal measured it and recorded it as not clearing: an inline `<svg>` belonging in an asset reads 45 of 51 = 0.882, under the gate before the Wilson bound is even asked. Kept here so nobody rebuilds it. |
| cypress_waits_on_alias | - | - | dropped | Measured at 40 of 89 = 0.449, a genuinely split repository. A ratio there is a description of a disagreement rather than of a habit. |
