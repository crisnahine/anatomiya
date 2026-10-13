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
    paren: ["parenthesized_expression"],
    args: ["argument_list"],
    // A decorated function sits in a node of its own, between the function and the body that holds it.
    wrap: ["decorated_definition"],
    tokensOf: [],
    name: "name",
    returnType: "return_type",
    bases: "superclasses",
    renamed: "alias",
    // What the reuse check reads as a name bound to a literal, which asks nothing.
    binding: ["assignment"],
    value: "right",
    // An assignment binds only where its target is made of these: a name, or a pattern of names. A
    // write through an attribute or a subscript may run a setter, `__setattr__` or `__setitem__`.
    target: "left",
    bound: ["identifier", "pattern_list", "tuple_pattern", "list_pattern", "list_splat_pattern"],
    // What a binding may hold outside its target and its value: an annotation made of names. Each is read
    // by its children, and a node of any other kind inside one asks.
    part: ["identifier", "attribute", "subscript", "type", "generic_type", "type_parameter", "union_type", "binary_operator", "list", "ellipsis"],
    // An annotation joins types with `|`, and any other operator computes.
    union: ["binary_operator"],
    literal: ["integer", "float", "true", "false", "none", "string", "concatenated_string"],
    // What a string's own text is made of: anything else inside one is an interpolation.
    literalPart: ["string_start", "string_content", "string_end", "escape_sequence", "escape_interpolation"],
    interpolation: ["interpolation"],
    unary: ["unary_operator"],
    // `1, 2` with no brackets is a tuple all the same.
    collection: ["list", "tuple", "expression_list", "dictionary", "pair", "set"],
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
    // `A::$e` spells its property as a variable, in the field a name sits in, and so does the `static $e;` that declares one.
    property: ["scoped_property_access_expression", "property_element"],
    base: ["base_clause"],
    // What a file holds outside any code: the tags, and the markup around them.
    header: ["php_tag", "php_end_tag", "text", "text_interpolation"],
    // The markup, which is code in another language where any of the file's markup holds a script.
    markup: ["text", "text_interpolation"],
    tokensOf: [],
    name: "name",
    returnType: "return_type",
    callee: "function",
    caught: "name",
    renamed: "alias",
    binding: ["const_element", "assignment_expression", "property_element"],
    value: "default_value",
    // An assignment is an expression: it binds only where it is the whole of one of these.
    statement: ["expression_statement"],
    // It binds only where its target is a variable or a pattern of them: a write through a property or
    // a subscript may run `__set` or `offsetSet`, and `$$x` names nothing by itself.
    target: "left",
    bound: ["variable_name", "name", "list_literal"],
    part: [
      "variable_name",
      "name",
      "visibility_modifier",
      "static_modifier",
      "final_modifier",
      "readonly_modifier",
      "var_modifier",
      "primitive_type",
      "optional_type",
      "named_type",
    ],
    literal: ["integer", "float", "boolean", "null", "string", "encapsed_string", "nowdoc"],
    literalPart: ["string_content", "escape_sequence", "heredoc_start", "nowdoc_body", "nowdoc_string", "heredoc_end"],
    // A double-quoted string interpolates any variable it names.
    interpolation: ["variable_name"],
    unary: ["unary_op_expression"],
    collection: ["array_creation_expression", "array_element_initializer"],
    // What holds bindings beside the modifiers and the type they share. Anything else, a property hook among them, asks.
    declaration: ["const_declaration", "property_declaration"],
  },
  go: {
    fn: ["function_declaration", "method_declaration"],
    // A Go method is written beside its type, so no body encloses one.
    cls: [],
    comment: ["comment"],
    import: ["import_declaration"],
    annotation: [],
    header: ["package_clause"],
    // What a comment directly above is C code for cgo to compile, where it imports "C" and nothing else.
    preambleOf: ["import_declaration", "import_spec"],
    receiverType: ["type_identifier"],
    tokensOf: [],
    name: "name",
    receiver: "receiver",
    binding: ["const_spec", "var_spec"],
    value: "value",
    // An array type is read by its children, so a length that is a call asks.
    part: [
      "identifier",
      "type_identifier",
      "qualified_type",
      "package_identifier",
      "pointer_type",
      "slice_type",
      "array_type",
      "implicit_length_array_type",
      "map_type",
      "interface_type",
      "struct_type",
      "field_declaration_list",
      "field_declaration",
      "field_identifier",
      "generic_type",
      "type_arguments",
      "type_elem",
    ],
    literal: ["int_literal", "float_literal", "imaginary_literal", "rune_literal", "interpreted_string_literal", "raw_string_literal", "true", "false", "nil"],
    literalPart: ["interpreted_string_literal_content", "raw_string_literal_content", "escape_sequence"],
    unary: ["unary_expression"],
    collection: ["expression_list", "composite_literal", "literal_value", "literal_element", "keyed_element"],
    // A composite literal's type says what it builds: it is read as a type, where the rest are values.
    collectionType: "type",
    declaration: ["const_declaration", "var_declaration", "var_spec_list"],
    // A constant repeats the one above it or is counted off `iota`: it has no value, or one of these and literals.
    counted: ["const_spec"],
    countedPart: ["iota", "expression_list", "binary_expression", "unary_expression", "parenthesized_expression"],
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
    // A label, and the name a `break` or a `continue` jumps to, is an identifier with no field. So is the
    // constant a `case` names and the one argument of `@A(e)`, and a caught variable is no constant.
    label: ["labeled_statement", "break_statement", "continue_statement", "switch_label", "annotation_argument_list"],
    // `A::e` names a method after what it is taken from, and neither has a field.
    reference: ["method_reference"],
    // An enum's methods sit one node deeper than its body, past the constants.
    wrap: ["enum_body_declarations"],
    iface: ["interface_declaration"],
    header: ["package_declaration"],
    // `public` and `static` are tokens of `modifiers`, and its text is not kept once an annotation sits beside them.
    tokensOf: ["modifiers"],
    name: "name",
    caught: "name",
    member: "field",
    // The name of an annotation's argument.
    key: "key",
    binding: ["variable_declarator"],
    value: "value",
    literal: [
      "decimal_integer_literal",
      "hex_integer_literal",
      "octal_integer_literal",
      "binary_integer_literal",
      "decimal_floating_point_literal",
      "hex_floating_point_literal",
      "true",
      "false",
      "character_literal",
      "string_literal",
      "null_literal",
    ],
    literalPart: ["string_fragment", "multiline_string_fragment", "escape_sequence"],
    // A string template's `\{...}` sits inside its string literal.
    interpolation: ["string_interpolation"],
    unary: ["unary_expression"],
    collection: ["array_initializer"],
    declaration: ["field_declaration", "local_variable_declaration", "constant_declaration"],
    part: ["identifier", "modifiers", "type_identifier", "scoped_type_identifier", "integral_type", "floating_point_type", "boolean_type", "generic_type", "type_arguments", "array_type", "dimensions"],
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
    // The one that opens a conditional, and the field its test sits in.
    conditional: ["preproc_if"],
    condition: "condition",
    // A directive on a line of its own between two members.
    directive: ["preproc_pragma", "preproc_nullable", "preproc_region", "preproc_endregion", "preproc_line", "preproc_error", "preproc_warning"],
    tokensOf: [],
    name: "name",
    usingAlias: "name",
    // A declarator's value has no field: it is its last named child.
    binding: ["variable_declarator"],
    literal: ["integer_literal", "real_literal", "boolean_literal", "character_literal", "string_literal", "verbatim_string_literal", "raw_string_literal", "null_literal"],
    literalPart: ["string_literal_content", "character_literal_content", "escape_sequence", "raw_string_start", "raw_string_content", "raw_string_end"],
    unary: ["prefix_unary_expression"],
    // Assumed, and compiled nowhere: an extension may define an operator a built-in type lacks. So a
    // sign is part of a literal only before what the language itself pairs it with: `-` and `+`, `~`,
    // and `!`. Where no such operator can exist, the cost is a false ask.
    signed: ["integer_literal", "real_literal", "character_literal"],
    inverted: ["integer_literal", "character_literal"],
    negated: ["boolean_literal"],
    collection: ["initializer_expression"],
    // A literal declared as a type with an `implicit operator` runs it, as `new Money(5)` would. So a
    // declared type is read: a literal is inert under a type made of these, as a `const`, or where it
    // is `null`, which the language converts itself. Given up: `Foo f = null;` where `Foo` is a
    // struct that converts from a reference type.
    declared: "type",
    builtin: ["predefined_type", "implicit_type", "nullable_type", "array_type", "array_rank_specifier"],
    // The one value no declared type converts with a function: the language makes `null` any reference type itself.
    nothing: ["null_literal"],
    // A directive that closes what another opened.
    closes: ["preproc_endregion"],
    declaration: ["field_declaration", "local_declaration_statement", "variable_declaration"],
    // An array's rank is read by its children, so a call in one asks.
    part: ["identifier", "modifier", "predefined_type", "implicit_type", "nullable_type", "qualified_name", "generic_name", "type_argument_list", "array_type", "array_rank_specifier"],
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
    // An `impl` block has no name of its own: it is known by the type it is written for.
    receiverType: ["type_identifier"],
    tokensOf: [],
    name: "name",
    implFor: "type",
    renamed: "alias",
    binding: ["const_item", "static_item", "let_declaration"],
    value: "value",
    // A let-else runs its block when the pattern does not match.
    alternative: "alternative",
    // An array type is read by its children, so a length that is a call, a macro or a block asks.
    part: [
      "identifier",
      "visibility_modifier",
      "crate",
      "mutable_specifier",
      "tuple_pattern",
      "primitive_type",
      "type_identifier",
      "scoped_type_identifier",
      "scoped_identifier",
      "generic_type",
      "type_arguments",
      "array_type",
      "tuple_type",
      "reference_type",
      "pointer_type",
      "lifetime",
    ],
    literal: ["integer_literal", "float_literal", "boolean_literal", "char_literal", "string_literal", "raw_string_literal"],
    literalPart: ["string_content", "escape_sequence"],
    unary: ["unary_expression"],
    collection: ["array_expression", "tuple_expression"],
  },
  kotlin: {
    fn: ["function_declaration"],
    cls: ["class_declaration", "object_declaration", "companion_object"],
    comment: ["line_comment", "block_comment"],
    import: ["import"],
    annotation: ["annotation"],
    args: ["value_arguments"],
    header: ["package_header"],
    // An extension function's receiver has no field: it is the type that stands before the name.
    receiverBeforeName: ["user_type", "nullable_type", "parenthesized_type"],
    // The `as` of `import a.B as C` is a token of `import`, and the name after it has no field.
    tokensOf: ["import"],
    renames: { token: "as" },
    name: "name",
    // A property's value has no field: it is its last named child.
    binding: ["property_declaration"],
    // What a property may hold outside its value: its name, its modifiers and a type made of names.
    part: ["variable_declaration", "identifier", "user_type", "nullable_type", "type_arguments", "type_projection", "modifiers", "visibility_modifier", "property_modifier", "member_modifier"],
    literal: ["number_literal", "float_literal", "character_literal", "string_literal", "multiline_string_literal"],
    literalPart: ["string_content", "escape_sequence"],
    // This grammar has no boolean or null literal: `true`, `false` and `null` are identifiers with that text.
    word: ["identifier"],
    interpolation: ["interpolation"],
    // It also reads `$name` in a one-line string as a content node holding the lone `$`.
    bareInterpolation: ["string_content"],
    unary: ["unary_expression"],
    // An `operator fun` extension stands behind any operator a built-in type lacks, so a sign is part
    // of a literal only before what the language itself pairs it with: `-` and `+`, and `!`.
    signed: ["number_literal", "float_literal"],
    negated: ["identifier"],
    // `listOf(...)` is a call, so nothing here is a collection literal.
    collection: [],
  },
};
