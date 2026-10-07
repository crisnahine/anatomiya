/**
 * What each tree-sitter grammar calls the things a row or a facet asks about.
 * A list holds node types, a string holds a field name and `{ token }` an
 * anonymous token of a node listed under `tokensOf`, which is how the test
 * checks every one of them against the vendored grammar.
 *
 * A renamed import's new name is no part of where it came from, and three
 * grammars mark it three ways: `renamed` is the field it fills, `usingAlias`
 * the field of the directive itself, and `renames` the token it follows.
 */
export const SHAPES = {
  python: {
    fn: ["function_definition"],
    cls: ["class_definition"],
    comment: ["comment"],
    import: ["import_statement", "import_from_statement", "future_import_statement"],
    imported: "name",
    annotation: ["decorator"],
    block: ["block"],
    docstring: ["expression_statement", "string", "concatenated_string"],
    args: ["argument_list"],
    // A decorated function sits in a node of its own, between the function and the body that holds it.
    wrap: ["decorated_definition"],
    tokensOf: [],
    name: "name",
    returnType: "return_type",
    bases: "superclasses",
    renamed: "alias",
  },
  php: {
    fn: ["function_definition", "method_declaration"],
    cls: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"],
    comment: ["comment"],
    catch: ["catch_clause"],
    import: ["namespace_use_declaration"],
    imported: ["namespace_use_clause"],
    annotation: ["attribute"],
    block: ["compound_statement"],
    args: ["arguments"],
    call: ["function_call_expression"],
    scope: ["namespace_definition"],
    raise: ["throw_expression"],
    ident: ["name"],
    // A name is a variable only inside one of these: `$x->e` spells `e` and reads no `$e`.
    variable: ["variable_name"],
    base: ["base_clause"],
    // What a file holds outside any code: the tags, and the markup around them.
    header: ["php_tag", "text", "text_interpolation"],
    tokensOf: [],
    name: "name",
    returnType: "return_type",
    callee: "function",
    caught: "name",
    renamed: "alias",
  },
  go: {
    fn: ["function_declaration", "method_declaration"],
    // A Go method is written beside its type, so no body encloses one.
    cls: [],
    comment: ["comment"],
    import: ["import_declaration"],
    annotation: [],
    header: ["package_clause"],
    receiverType: ["type_identifier"],
    tokensOf: [],
    name: "name",
    receiver: "receiver",
  },
  java: {
    fn: ["method_declaration"],
    cls: ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"],
    comment: ["line_comment", "block_comment"],
    catch: ["catch_clause"],
    import: ["import_declaration"],
    annotation: ["marker_annotation", "annotation"],
    block: ["block"],
    args: ["annotation_argument_list"],
    raise: ["throw_statement"],
    ident: ["identifier"],
    // An enum's methods sit one node deeper than its body, past the constants.
    wrap: ["enum_body_declarations"],
    iface: ["interface_declaration"],
    header: ["package_declaration"],
    // `public` and `static` are tokens of `modifiers`, and its text is not kept once an annotation sits beside them.
    tokensOf: ["modifiers"],
    name: "name",
    caught: "name",
    member: "field",
  },
  csharp: {
    fn: ["method_declaration", "local_function_statement"],
    cls: ["class_declaration", "interface_declaration", "struct_declaration", "record_declaration"],
    comment: ["comment"],
    import: ["using_directive"],
    annotation: ["attribute"],
    args: ["attribute_argument_list"],
    iface: ["interface_declaration"],
    // A conditional around whole members holds them, where the file read as written.
    wrap: ["preproc_if", "preproc_elif", "preproc_else"],
    // A directive on a line of its own between two members.
    directive: ["preproc_pragma", "preproc_nullable", "preproc_region", "preproc_endregion", "preproc_line", "preproc_error", "preproc_warning"],
    tokensOf: [],
    name: "name",
    usingAlias: "name",
  },
  rust: {
    fn: ["function_item"],
    cls: ["impl_item", "trait_item"],
    scope: ["mod_item"],
    comment: ["line_comment", "block_comment"],
    import: ["use_declaration"],
    annotation: ["attribute_item", "inner_attribute_item"],
    // `#![...]` stands on what it is written inside, not on what follows it.
    inner: ["inner_attribute_item"],
    doc: ["outer_doc_comment_marker"],
    args: ["token_tree"],
    tokensOf: [],
    name: "name",
    renamed: "alias",
  },
  kotlin: {
    fn: ["function_declaration"],
    cls: ["class_declaration", "object_declaration", "companion_object"],
    comment: ["line_comment", "block_comment"],
    import: ["import"],
    annotation: ["annotation"],
    args: ["value_arguments"],
    header: ["package_header"],
    // The `as` of `import a.B as C` is a token of `import`, and the name after it has no field.
    tokensOf: ["import"],
    renames: { token: "as" },
    name: "name",
  },
};
