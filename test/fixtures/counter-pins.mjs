/**
 * Which dimensions may state their inverse, pinned by name.
 *
 * The ban list is a safety decision, not a detection detail (C6). Pinning the
 * set makes a row arriving with a counter-claim, or a refused one gaining it in
 * a refactor, cost a reviewed diff instead of being inherited. Refusal is an
 * explicit `null` on the row, never an absent key, and every registry key is on
 * exactly one of these two lists.
 *
 * One copy, read twice: `test/gates.test.mjs` holds the lists to the registry,
 * and `scripts/check-docs.mjs` reads them to tell an author which list a new
 * key still owes. Two copies would answer differently the moment a row moved
 * between the lists, and neither reader would say so.
 */

/** Rows carrying a hand-written `counterClaim`. */
export const ELIGIBLE = [
  "function_style", "type_only_import", "import_extension", "test_call_style",
  "assertion_style", "absent_is_null", "doc_comment_style",
  "record_lookup", "model_callbacks", "service_result_shape",
  "hook_call_style", "handler_is_named", "handler_memoised",
];

/** Rows whose other side is a defect rather than a style anyone picked. */
export const REFUSED = [
  "swallowed_error", "rescue_uses_error", "zone_aware_time", "non_null_assertion",
  "optional_chaining", "nullish_default", "module_state_const", "keyword_params",
  "explicit_return_type", "error_shape", "async_error_handling",
  // The inverse reads "a module exports several hooks", which as a directive
  // asks an agent to grow a module rather than describing a habit anyone chose.
  "hook_per_module",
  // `.forEach` cannot await, break, or return from the enclosing function.
  // Stated as an area's convention, the check asked for an await loop to be
  // rewritten into the classic bug.
  "iterate_with_for_of",
  "spread_on_component", "text_translated",
  // The inverse reads "a call chain crosses several types", which as a
  // directive asks an agent to reach through one object to another.
  "law_of_demeter",
  "migration_reversible", "migration_schema_only", "column_null_declared",
  "table_primary_key_declared", "reference_foreign_key",
  // The other side of a learned class is another class, which the learning
  // already picks; a hand-written inverse would fight it.
  "function_naming_case", "exported_symbol_case", "exported_class_case", "exported_type_case", "file_naming_case",
  "extends_base", "class_base", "module_include",
  "interface_prefix", "type_alias_prefix",
  // "This repository logs to the console on purpose" is a repository with no
  // wrapper, and there the row is not offered at all (C8): a counter would
  // only ever state where a wrapper exists and is ignored, which is a defect.
  "route_logging", "route_network", "route_env",
  "logger_over_puts", "http_through_client",
  // A companion that does not exist is an absence. The inverse reads "a model
  // ships without a spec", which is a directive to write one test fewer.
  "rake_task_spec", "model_spec", "service_spec", "job_spec", "worker_spec",
  "controller_spec", "serializer_spec", "model_test", "job_test",
];
