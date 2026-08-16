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
| optional_chaining | Null safety | - | shipped | |
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
| record_lookup | Exception-driven control flow | - | shipped | |
| model_callbacks | Fat model / callback soup | - | shipped | |
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
| worker_spec | - | - | shipped | |
| controller_spec | - | - | shipped | |
| serializer_spec | - | - | shipped | |
| model_test | - | - | shipped | |
| job_test | - | - | shipped | |
| law_of_demeter | Law of Demeter | Law of Demeter | shipped | The glossary name is the principle's, and a ratio beside it reads as agreement with the principle rather than as a count of this repository's chains. The key says what is counted: a call chain whose receivers are one type. The only semantic row, so it reaches a scan only with --deep |
| file_naming_case | - | - | shipped | Written from the measured naming-divergence literature rather than the glossary. The class is learned per area from the plurality of its own filenames, a tie learns nothing, and a class that moved since the pin closes the slot |
| route_logging | - | - | shipped | The most cited agent symptom is framework-default code instead of the repository's wrapper. The wrapper is learned per file from relative imports whose filename says log, logger or logging; offered only where the corpus shows such a file (C8) |
| route_network | - | - | shipped | Same shape over fetch and axios against a client, http, api, request or fetcher module |
| route_env | - | - | shipped | Same shape over process.env against a config, env or settings module |
| logger_over_puts | - | - | shipped | The Ruby side of route_logging, under its own key because one key is one predicate and the two engines read different trees. puts, print, p, pp and warn with no receiver, in any position rather than statement position only, because prism reports no such distinction cheaply and the partial mark carries the cost; print rides along because it is the same stdout habit. Offered only where the repository has adopted a wrapper (C14) |
| http_through_client | - | - | shipped | The Ruby side of route_network, keyed apart for the same reason: Net::HTTP and URI.open against a constant or variable named in the client vocabulary |
| doc_comment_style | - | - | shipped | Written from the measured comment-divergence literature. Two real sides: repositories that document their export surface, and repositories whose files carry almost no comments, where the counter is the directive that stops tutorial-style over-commenting |
| function_naming_case | - | - | shipped | The same learning over module-level function names. Module level only, matching function_style's altitude: a method answers to its class's convention |
| exported_symbol_case | - | - | shipped | The same learning over a module's export surface, where a naming convention costs its consumers. Blind on a Flow-stripped file, because the retry deletes a type-only export whole |
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
