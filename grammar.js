/**
 * tree-sitter-expo
 * -----------------
 * Tree-sitter grammar for the Expo programming language.
 * Authored from `../expo/grammar.ebnf` and the reference
 * implementation in `../expo/crates/expo-parser/`.
 *
 * Conventions:
 *   - Snake_case node names match the EBNF rule names where possible
 *     (e.g. `function_declaration`, `match_expression`, `struct_construction`)
 *     so editor query files stay stable as the grammar evolves.
 *   - Keywords (`fn`, `struct`, ...) are anonymous string tokens.
 *   - `identifier` is lowercase-leading, `type_identifier` is PascalCase.
 *   - Statement separation uses an external `_newline` token; the scanner
 *     emits it only where the grammar accepts it (between block items).
 *   - String bodies use external scanner tokens for content, leaving
 *     `#{...}` and escape sequences as ordinary grammar tokens.
 */

const PREC = {
  ternary: 1,
  arrow: 2,
  or: 3,
  and: 4,
  not: 5,
  cmp: 6,
  add: 7,
  mul: 8,
  unary: 9,
  postfix: 10,
  type_args: 11,
};

// Keywords that are reserved per `expo/grammar.ebnf` § 18.
const RESERVED = [
  "after",
  "alias",
  "as",
  "break",
  "cond",
  "const",
  "else",
  "end",
  "enum",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "loop",
  "match",
  "move",
  "not",
  "priv",
  "protocol",
  "receive",
  "return",
  "self",
  "spawn",
  "struct",
  "true",
  "type",
  "unless",
  "when",
  "while",
];

// Identifier regex (lowercase-leading per EBNF). The `?` and `!` suffixes
// match the language's "predicate" and "bang" function-naming conventions.
const IDENT = /[a-z_][a-zA-Z0-9_]*[?!]?/;

// PascalCase type identifier (struct/enum/protocol/package names).
// The `_` is permitted to support ALL_CAPS module-level constants like
// `MAX_SIZE`, which the reference lexer treats as `TypeIdent` because
// they start with an uppercase letter.
const TYPE_IDENT = /[A-Z][a-zA-Z0-9_]*/;

// Format spec inside `#{ expr : SPEC }` interpolations.
const FORMAT_SPEC = /[a-zA-Z0-9.<>^+\-0]+/;

module.exports = grammar({
  name: "expo",

  word: ($) => $.identifier,

  // Whitespace and comments are skipped everywhere; newlines are NOT in
  // extras because they are significant statement terminators handled by
  // the external scanner.
  extras: ($) => [/[ \t\r]+/, $.comment],

  externals: ($) => [
    $._newline,
    $._string_content,
    $._mstring_content,
    $._string_close,
    $._mstring_close,
  ],

  conflicts: ($) => [
    // ─── Block boundaries ──────────────────────────────────────────
    // At each `_newline` inside a block, the parser must decide
    // whether to continue with another statement or reduce the
    // block so the surrounding `end` / `else` / next match arm can
    // take over. The self-conflict lets GLR explore both paths;
    // lookahead settles it.
    [$.block],

    // ─── Function & closure ambiguities ────────────────────────────
    // `fn name(...)` is structurally ambiguous: `(...)` could be the
    // parameter list of a function declaration or the start of the
    // body's first expression (`(x) -> y` short closure, `()` unit).
    // The dynamic precedence on `parameters` makes the function-
    // signature interpretation win once GLR has explored both.
    [$.parameters, $._closure_params_short],
    [$.parameters, $.unit_literal],
    [$._closure_params_short, $.unit_literal],
    [$._closure_params_short, $.unit_type],
    [$.parameter, $.closure_param],
    [$.closure_param, $._primary_expr],
    // Bodyless `@extern` / `@intrinsic` declarations overlap with
    // their full-body counterparts until an `end` clarifies. The
    // dynamic precedences (`+10` on full forms, `-10` on extern)
    // pick the right one.
    [$.function_declaration, $.extern_function_declaration],
    [$.priv_function, $.extern_function_declaration],
    // Protocol methods come in bodyless signature and full
    // (default-impl) flavours. Same pattern as above.
    [$.protocol_method],

    // ─── Type vs expression ambiguities ────────────────────────────
    // A bare `Foo` could be a named type or the head of an
    // expression (constructor / enum path / method call on type).
    // After a `type_identifier`, a following `.` extends the path
    // for either the named-type, enum-construction, or postfix-
    // method-call interpretation; lookahead beyond the path picks.
    [$.named_type, $._primary_expr],
    [$.named_type, $._primary_expr, $._enum_construction_path],
  ],

  supertypes: ($) => [
    $._top_level_decl,
    $._statement,
    $._expression,
    $._primary_expr,
    $._primary_type,
    $._pattern,
    $._literal,
  ],

  rules: {
    // ====================================================================
    // 1. Program
    // ====================================================================

    source_file: ($) =>
      seq(
        optional($._newline),
        repeat(seq($._top_level_decl, optional($._newline))),
      ),

    _top_level_decl: ($) =>
      choice(
        $.struct_declaration,
        $.enum_declaration,
        $.protocol_declaration,
        $.impl_block,
        $.function_declaration,
        $.priv_function,
        $.const_declaration,
        $.type_alias_declaration,
        $.alias_declaration,
        $.annotated_declaration,
      ),

    // Multiple annotations stack on the same declaration, separated by
    // newlines (e.g. `@doc "..."\n@intrinsic\nfn empty?(self) -> Bool`).
    annotated_declaration: ($) =>
      seq(
        $._annotation,
        repeat(seq(optional($._newline), $._annotation)),
        optional($._newline),
        choice(
          $.struct_declaration,
          $.enum_declaration,
          $.protocol_declaration,
          $.function_declaration,
          $.priv_function,
          $.extern_function_declaration,
          $.const_declaration,
          $.type_alias_declaration,
        ),
      ),

    // ====================================================================
    // 2. Annotations
    // ====================================================================

    _annotation: ($) => $.annotation,

    annotation: ($) =>
      seq(
        "@",
        field("name", $.identifier),
        optional(field("value", $._annotation_value)),
      ),

    _annotation_value: ($) => choice($.string, $.multiline_string, "false"),

    // ====================================================================
    // 3. Struct
    // ====================================================================

    struct_declaration: ($) =>
      seq(
        "struct",
        field("name", $.type_identifier),
        optional(field("type_parameters", $.type_parameters)),
        optional($._newline),
        repeat(seq($._struct_member, optional($._newline))),
        "end",
      ),

    _struct_member: ($) =>
      choice(
        $.struct_field,
        $.function_declaration,
        $.priv_function,
        $.annotated_declaration,
      ),

    struct_field: ($) =>
      seq(
        field("name", $.identifier),
        ":",
        field("type", $._type_expression),
        optional(seq("=", field("default", $._expression))),
      ),

    // ====================================================================
    // 4. Enum
    // ====================================================================

    enum_declaration: ($) =>
      seq(
        "enum",
        field("name", $.type_identifier),
        optional(field("type_parameters", $.type_parameters)),
        optional($._newline),
        repeat(seq($._enum_member, optional($._newline))),
        "end",
      ),

    _enum_member: ($) =>
      choice(
        $.enum_variant,
        $.function_declaration,
        $.priv_function,
        $.annotated_declaration,
      ),

    enum_variant: ($) =>
      seq(
        field("name", $.type_identifier),
        optional(
          choice(
            seq(
              "(",
              commaSep(optional($._newline), $._type_expression),
              optional($._newline),
              ")",
            ),
            seq(
              "{",
              optional($._newline),
              commaSep(optional($._newline), $.struct_field),
              optional(","),
              optional($._newline),
              "}",
            ),
          ),
        ),
      ),

    // ====================================================================
    // 5. Protocol
    // ====================================================================

    protocol_declaration: ($) =>
      seq(
        "protocol",
        field("name", $.type_identifier),
        optional(field("type_parameters", $.type_parameters)),
        optional($._newline),
        repeat(
          seq(
            choice($.protocol_method, $.annotated_protocol_method),
            optional($._newline),
          ),
        ),
        "end",
      ),

    annotated_protocol_method: ($) =>
      seq(
        $._annotation,
        repeat(seq(optional($._newline), $._annotation)),
        optional($._newline),
        $.protocol_method,
      ),

    // Protocol methods come in two flavours: bodyless signatures
    // (`fn name(...) -> Type`) and default implementations with a
    // trailing `end`. We split them into explicit alternatives so the
    // bodyless form can't accidentally swallow the *next* method's
    // body or the surrounding protocol's `end`. GLR (via the
    // conflicts list) explores both; dynamic precedence prefers the
    // with-body form when an `end` is reachable.
    protocol_method: ($) =>
      choice(
        prec.dynamic(10, seq(...fnHeader($), ...blockBody($), "end")),
        prec.dynamic(-10, seq(...fnHeader($))),
      ),

    // ====================================================================
    // 6. Impl
    // ====================================================================

    impl_block: ($) =>
      seq(
        "impl",
        field("target", $._type_expression),
        optional(seq("for", field("trait", $._type_expression))),
        optional($._newline),
        repeat(seq($._impl_member, optional($._newline))),
        "end",
      ),

    _impl_member: ($) =>
      choice(
        $.function_declaration,
        $.priv_function,
        $.type_alias_declaration,
        $.annotated_declaration,
      ),

    // ====================================================================
    // 7. Function
    // ====================================================================

    // Public function with a body. `prec.dynamic(10)` makes this
    // interpretation win over the bodyless
    // `extern_function_declaration` whenever an `end` keyword is
    // reachable.
    function_declaration: ($) =>
      prec.dynamic(10, seq(...fnHeader($), ...blockBody($), "end")),

    priv_function: ($) =>
      prec.dynamic(10, seq("priv", ...fnHeader($), ...blockBody($), "end")),

    // Bodyless declaration used under `@extern` / `@intrinsic`. The
    // negative dynamic precedence makes the full-body forms above win
    // whenever an `end` keyword follows. The optional `priv` covers
    // stdlib FFI declarations like `priv fn evp_sha1 -> CPtr<UInt8>`.
    extern_function_declaration: ($) =>
      prec.dynamic(-10, seq(optional("priv"), ...fnHeader($))),

    return_type: ($) => seq("->", $._type_expression),

    // Dynamic precedence: when a parenthesised header on a function
    // declaration could either bind as parameters or as the start of a
    // body expression (parenthesised_expression / short_closure /
    // unit_literal), GLR explores all branches and we prefer this one.
    parameters: ($) =>
      prec.dynamic(
        20,
        seq(
          "(",
          optional($._newline),
          optional(
            seq(
              commaSep1(optional($._newline), $._param_or_self),
              optional(","),
            ),
          ),
          optional($._newline),
          ")",
        ),
      ),

    _param_or_self: ($) => choice($.parameter, $.self_parameter),

    parameter: ($) =>
      seq(
        optional(field("mode", "move")),
        field("name", $.identifier),
        ":",
        field("type", $._type_expression),
        optional(seq("=", field("default", $._expression))),
      ),

    self_parameter: ($) =>
      prec(2, seq(optional(field("mode", "move")), "self")),

    // ====================================================================
    // 8. Type expressions
    // ====================================================================

    _type_expression: ($) => choice($.union_type, $._primary_type),

    // Higher precedence than `_type_expression` so we always extend
    // a union greedily when `|` follows a primary type.
    union_type: ($) =>
      prec.right(1, seq($._primary_type, repeat1(seq("|", $._primary_type)))),

    _primary_type: ($) =>
      choice(
        $.function_type,
        $.generic_type,
        $.named_type,
        $.self_type,
        $.unit_type,
      ),

    function_type: ($) =>
      seq(
        "fn",
        "(",
        optional($._newline),
        optional(commaSep(optional($._newline), $.fn_type_parameter)),
        optional($._newline),
        ")",
        "->",
        $._type_expression,
      ),

    fn_type_parameter: ($) => seq(optional("move"), $._type_expression),

    generic_type: ($) =>
      prec(
        PREC.type_args,
        seq(
          field("name", $.named_type),
          field("type_arguments", $.type_arguments),
        ),
      ),

    type_arguments: ($) =>
      seq(
        "<",
        optional($._newline),
        commaSep1(optional($._newline), $._type_expression),
        optional($._newline),
        ">",
      ),

    named_type: ($) =>
      prec.left(seq($.type_identifier, repeat(seq(".", $.type_identifier)))),

    self_type: ($) => "Self",

    unit_type: ($) => seq("(", ")"),

    // Generic parameters on declarations (uses & for trait bounds).
    type_parameters: ($) =>
      seq("<", commaSep1(optional($._newline), $.type_parameter), ">"),

    type_parameter: ($) =>
      seq(
        field("name", $.type_identifier),
        optional(seq(":", field("bounds", sepBy1("&", $.type_identifier)))),
      ),

    // ====================================================================
    // 9. Top-level / impl-level declarations: const, alias, type
    // ====================================================================

    const_declaration: ($) =>
      seq(
        "const",
        field("name", choice($.identifier, $.type_identifier)),
        optional(seq(":", field("type", $._type_expression))),
        "=",
        field("value", $._expression),
      ),

    type_alias_declaration: ($) =>
      seq(
        "type",
        field("name", $.type_identifier),
        "=",
        field("type", $._type_expression),
      ),

    alias_declaration: ($) =>
      seq(
        "alias",
        field("path", $.alias_path),
        optional(seq("as", field("local_name", $.type_identifier))),
      ),

    alias_path: ($) =>
      seq(
        choice($.identifier, $.type_identifier),
        repeat(seq(".", choice($.identifier, $.type_identifier))),
      ),

    // ====================================================================
    // 10. Block / statements
    // ====================================================================

    // A block is one or more statements separated by newlines, with
    // an optional trailing newline. The trailing newline is what
    // gives the parser a reduce path when an `end` (or similar
    // closer) follows; without it tree-sitter ends up emitting `end`
    // as an identifier and the block runs off the rails. Statement
    // separators are declared as a conflict (`[$.block]`) so GLR can
    // simultaneously explore "extend the block" and "stop here" —
    // this keeps multi-statement bodies working inside `match` arms.
    block: ($) =>
      seq(
        $._statement,
        repeat(seq($._newline, $._statement)),
        optional($._newline),
      ),

    _statement: ($) =>
      choice(
        $.return_statement,
        $.break_statement,
        $.compound_assignment,
        $.assignment,
        $.expression_statement,
      ),

    expression_statement: ($) => $._expression,

    return_statement: ($) =>
      prec.right(seq("return", optional(field("value", $._expression)))),

    break_statement: ($) => "break",

    // Newlines after `=`/`+=`/etc are line continuations (mirroring
    // the lexer's `continues_line` rule), so we accept an optional
    // `_newline` between the operator and the right-hand expression.
    assignment: ($) =>
      choice(
        // Typed binding: `name: Type = expr`
        seq(
          field("target", $.identifier),
          ":",
          field("type", $._type_expression),
          "=",
          optional($._newline),
          field("value", $._expression),
        ),
        // Plain assignment: `lvalue = expr`
        prec(
          1,
          seq(
            field("target", $._lvalue),
            "=",
            optional($._newline),
            field("value", $._expression),
          ),
        ),
      ),

    compound_assignment: ($) =>
      seq(
        field("target", $._lvalue),
        field("operator", choice("+=", "-=", "*=", "/=", "%=")),
        optional($._newline),
        field("value", $._expression),
      ),

    _lvalue: ($) => choice($.identifier, $.field_access, "self"),

    // ====================================================================
    // 11. Expressions (precedence climbing matches expo-parser)
    // ====================================================================

    _expression: ($) =>
      choice(
        $.short_closure,
        $.ternary_expression,
        $.binary_expression,
        $.unary_expression,
        $._postfix_expr,
      ),

    // Short closure: `params -> body`. Body is a full expression.
    short_closure: ($) =>
      prec.right(
        PREC.arrow,
        seq(
          field("parameters", $._closure_params_short),
          "->",
          field("body", $._expression),
        ),
      ),

    _closure_params_short: ($) =>
      choice(
        $.closure_param,
        seq("(", commaSep(optional($._newline), $.closure_param), ")"),
      ),

    closure_param: ($) =>
      choice(
        $.wildcard,
        seq(
          optional("move"),
          field("name", $.identifier),
          optional(seq(":", field("type", $._type_expression))),
        ),
      ),

    // The lexer's `continues_line` rule already suppresses newlines
    // *after* `?` and `:`, so multi-line ternaries with the
    // operators at end-of-line work without grammar help. The
    // start-of-line style (`cond\n  ? a\n  : b`) would require a
    // newline *before* `?`, which fundamentally collides with
    // statement termination at assignment scope and explodes the
    // conflict graph; we accept that style as a parse error and
    // rely on tree-sitter's error recovery to keep the rest of the
    // file highlighted.
    ternary_expression: ($) =>
      prec.right(
        PREC.ternary,
        seq(
          field("condition", $._expression),
          "?",
          optional($._newline),
          field("consequence", $._expression),
          ":",
          optional($._newline),
          field("alternative", $._expression),
        ),
      ),

    binary_expression: ($) =>
      choice(
        ...[
          ["or", PREC.or],
          ["and", PREC.and],
        ].map(([op, p]) =>
          prec.left(
            p,
            seq(
              field("left", $._expression),
              field("operator", alias(op, $.operator)),
              optional($._newline),
              field("right", $._expression),
            ),
          ),
        ),
        ...[
          ["==", PREC.cmp],
          ["!=", PREC.cmp],
          ["<", PREC.cmp],
          [">", PREC.cmp],
          ["<=", PREC.cmp],
          [">=", PREC.cmp],
        ].map(([op, p]) =>
          prec.left(
            p,
            seq(
              field("left", $._expression),
              field("operator", op),
              optional($._newline),
              field("right", $._expression),
            ),
          ),
        ),
        ...[
          ["+", PREC.add],
          ["-", PREC.add],
          ["<>", PREC.add],
        ].map(([op, p]) =>
          prec.left(
            p,
            seq(
              field("left", $._expression),
              field("operator", op),
              optional($._newline),
              field("right", $._expression),
            ),
          ),
        ),
        ...[
          ["*", PREC.mul],
          ["/", PREC.mul],
          ["%", PREC.mul],
        ].map(([op, p]) =>
          prec.left(
            p,
            seq(
              field("left", $._expression),
              field("operator", op),
              optional($._newline),
              field("right", $._expression),
            ),
          ),
        ),
      ),

    unary_expression: ($) =>
      choice(
        prec(
          PREC.unary,
          seq(field("operator", "-"), field("operand", $._expression)),
        ),
        prec(
          PREC.not,
          seq(field("operator", "not"), field("operand", $._expression)),
        ),
      ),

    _postfix_expr: ($) =>
      choice($.call, $.method_call, $.field_access, $._primary_expr),

    call: ($) =>
      prec(
        PREC.postfix,
        seq(
          field("callee", $._postfix_expr),
          field("arguments", $.argument_list),
        ),
      ),

    // method_call binds tighter than field_access so `x.foo(...)`
    // chooses the call interpretation rather than a field access
    // followed by a parenthesized expression.
    method_call: ($) =>
      prec(
        PREC.postfix + 1,
        seq(
          field("receiver", $._postfix_expr),
          ".",
          field("method", $.identifier),
          field("arguments", $.argument_list),
        ),
      ),

    field_access: ($) =>
      prec(
        PREC.postfix,
        seq(
          field("receiver", $._postfix_expr),
          ".",
          field("field", $.identifier),
        ),
      ),

    argument_list: ($) =>
      seq(
        "(",
        optional($._newline),
        optional(
          seq(commaSep1(optional($._newline), $.argument), optional(",")),
        ),
        optional($._newline),
        ")",
      ),

    argument: ($) =>
      choice(
        seq(
          field("name", $.identifier),
          ":",
          optional($._newline),
          field("value", $._expression),
        ),
        field("value", $._expression),
      ),

    _primary_expr: ($) =>
      choice(
        $._literal,
        $.list,
        $.map,
        $.binary_literal,
        $.identifier,
        $.type_identifier,
        $.self_expression,
        $.struct_construction,
        $.enum_construction,
        $.parenthesized_expression,
        $.unit_literal,
        $.closure,
        $.if_expression,
        $.unless_expression,
        $.match_expression,
        $.cond_expression,
        $.for_expression,
        $.loop_expression,
        $.while_expression,
        $.receive_expression,
        $.spawn_expression,
      ),

    self_expression: ($) => "self",

    parenthesized_expression: ($) =>
      seq("(", optional($._newline), $._expression, optional($._newline), ")"),

    unit_literal: ($) => seq("(", ")"),

    // ====================================================================
    // 12. Constructions
    // ====================================================================

    struct_construction: ($) =>
      seq(
        field("type", $.named_type),
        "{",
        optional($._newline),
        commaSep(optional($._newline), $.field_init),
        optional(","),
        optional($._newline),
        "}",
      ),

    field_init: ($) =>
      seq(
        field("name", $.identifier),
        ":",
        optional($._newline),
        field("value", $._expression),
      ),

    // The trailing `(...)` / `{...}` is preferred when present — that's
    // how `Some(x)` and `Point.Origin{}` distinguish themselves from a
    // bare path followed by a separate call expression.
    enum_construction: ($) =>
      prec.right(
        seq(
          field("type", $._enum_construction_path),
          ".",
          field("variant", $.type_identifier),
          optional(
            choice(
              seq(
                "(",
                optional($._newline),
                commaSep(optional($._newline), $._expression),
                optional($._newline),
                ")",
              ),
              seq(
                "{",
                optional($._newline),
                commaSep(optional($._newline), $.field_init),
                optional(","),
                optional($._newline),
                "}",
              ),
            ),
          ),
        ),
      ),

    // No outer precedence: we only want this interpretation when the
    // input is actually `Type(.Type)+ . Variant` for an
    // enum_construction; in `List.new()` we want the same prefix to
    // reduce as a `_primary_expr` instead. We do need `prec.left` so
    // the path itself associates left when it does match.
    _enum_construction_path: ($) =>
      prec.left(seq($.type_identifier, repeat(seq(".", $.type_identifier)))),

    // ====================================================================
    // 13. Closures
    // ====================================================================

    closure: ($) =>
      seq(
        "fn",
        "(",
        optional($._newline),
        optional(commaSep1(optional($._newline), $.closure_param)),
        optional($._newline),
        ")",
        optional(field("return_type", $.return_type)),
        ...blockBody($),
        "end",
      ),

    // ====================================================================
    // 14. Control flow
    // ====================================================================

    if_expression: ($) =>
      seq(
        "if",
        field("condition", $._expression),
        ...blockBody($, "then"),
        optional(seq("else", ...blockBody($, "else"))),
        "end",
      ),

    unless_expression: ($) =>
      seq("unless", field("condition", $._expression), ...blockBody($), "end"),

    match_expression: ($) =>
      seq(
        "match",
        field("subject", $._expression),
        optional($._newline),
        repeat(seq($.match_arm, optional($._newline))),
        "end",
      ),

    match_arm: ($) =>
      seq(
        field("pattern", $.or_pattern),
        optional(seq("when", field("guard", $._expression))),
        "->",
        field("body", $._match_body),
      ),

    // The trailing newline between an arm body's last statement and
    // the next arm (or the closing `end`) is consumed by the parent
    // `match_expression` / `cond_expression` loop, so this body
    // doesn't include one of its own.
    _match_body: ($) => seq(optional($._newline), $.block),

    // `|` between patterns is a binary-operator-style separator: the
    // lexer's continues_line suppression lets the pattern wrap onto
    // the next line, so we accept an optional newline after `|`.
    or_pattern: ($) =>
      seq($._pattern, repeat(seq("|", optional($._newline), $._pattern))),

    cond_expression: ($) =>
      seq(
        "cond",
        optional($._newline),
        repeat(seq($.cond_arm, optional($._newline))),
        optional(seq($.cond_else, optional($._newline))),
        "end",
      ),

    cond_arm: ($) =>
      seq(
        field("condition", $._expression),
        "->",
        field("body", $._match_body),
      ),

    cond_else: ($) => seq("else", "->", field("body", $._match_body)),

    for_expression: ($) =>
      seq(
        "for",
        field("pattern", $._pattern),
        "in",
        field("iterable", $._expression),
        ...blockBody($),
        "end",
      ),

    loop_expression: ($) => seq("loop", ...blockBody($), "end"),

    while_expression: ($) =>
      seq("while", field("condition", $._expression), ...blockBody($), "end"),

    receive_expression: ($) =>
      seq(
        "receive",
        optional($._newline),
        repeat(seq($.match_arm, optional($._newline))),
        optional(
          seq(
            "after",
            field("timeout", $._expression),
            ...blockBody($, "after_body"),
          ),
        ),
        "end",
      ),

    spawn_expression: ($) =>
      prec.right(seq("spawn", field("expression", $._expression))),

    // ====================================================================
    // 15. Patterns
    // ====================================================================

    _pattern: ($) =>
      choice(
        $.wildcard,
        $._literal,
        $.negative_literal_pattern,
        $.typed_binding_pattern,
        $.binding_pattern,
        $.enum_pattern,
        $.struct_pattern,
        $.constructor_pattern,
        $.list_pattern,
        $.binary_pattern,
        $.unit_literal,
      ),

    wildcard: ($) => "_",

    negative_literal_pattern: ($) => seq("-", choice($.integer, $.float)),

    binding_pattern: ($) => $.identifier,

    // Use `_primary_type` (non-union) here so the `|` after the type
    // unambiguously belongs to `or_pattern`, not a type union.
    typed_binding_pattern: ($) =>
      seq(field("name", $.identifier), ":", field("type", $._primary_type)),

    enum_pattern: ($) =>
      seq(
        field("type", $._enum_construction_path),
        ".",
        field("variant", $.type_identifier),
        optional(
          choice(
            seq(
              "(",
              optional($._newline),
              commaSep(optional($._newline), $._pattern),
              optional($._newline),
              ")",
            ),
            seq(
              "{",
              optional($._newline),
              commaSep(optional($._newline), $.field_pattern),
              optional(","),
              optional($._newline),
              "}",
            ),
          ),
        ),
      ),

    struct_pattern: ($) =>
      seq(
        field("type", $.type_identifier),
        "{",
        optional($._newline),
        commaSep(optional($._newline), $.field_pattern),
        optional(","),
        optional($._newline),
        "}",
      ),

    // `Foo(a, b)`, `Foo()`, or just `Foo` (bare unit-variant
    // shorthand). The arguments are optional so the same rule covers
    // all three shapes.
    constructor_pattern: ($) =>
      seq(
        field("name", $.type_identifier),
        optional(
          seq(
            "(",
            optional($._newline),
            commaSep(optional($._newline), $._pattern),
            optional($._newline),
            ")",
          ),
        ),
      ),

    list_pattern: ($) =>
      seq(
        "[",
        optional($._newline),
        optional(commaSep1(optional($._newline), $._pattern)),
        optional($._newline),
        "]",
      ),

    field_pattern: ($) =>
      seq(field("name", $.identifier), ":", field("pattern", $._pattern)),

    // ====================================================================
    // 16. Binary / bitstring literals
    // ====================================================================

    binary_literal: ($) =>
      seq(
        "<<",
        optional($._newline),
        optional(commaSep1(optional($._newline), $.binary_segment)),
        optional($._newline),
        ">>",
      ),

    binary_pattern: ($) =>
      seq(
        "<<",
        optional($._newline),
        optional(commaSep1(optional($._newline), $.binary_segment)),
        optional($._newline),
        ">>",
      ),

    binary_segment: ($) =>
      seq(
        field("value", $._expression),
        optional(
          choice(
            seq(":", field("type", $._type_expression)),
            seq(
              "::",
              field("size", $._expression),
              optional($.binary_modifier_byte),
              repeat($.binary_modifier),
            ),
          ),
        ),
      ),

    binary_modifier_byte: ($) => "byte",

    binary_modifier: ($) => choice("signed", "unsigned", "big", "little"),

    // ====================================================================
    // 17. Literals
    // ====================================================================

    _literal: ($) =>
      choice($.integer, $.float, $.boolean, $.string, $.multiline_string),

    integer: ($) =>
      choice(/[0-9][0-9_]*/, /0x[0-9a-fA-F][0-9a-fA-F_]*/, /0b[01][01_]*/),

    float: ($) => /[0-9][0-9_]*\.[0-9][0-9_]*/,

    boolean: ($) => choice("true", "false"),

    list: ($) =>
      seq(
        "[",
        optional($._newline),
        optional(
          seq(commaSep1(optional($._newline), $._expression), optional(",")),
        ),
        optional($._newline),
        "]",
      ),

    map: ($) =>
      choice(
        seq("[", optional($._newline), ":", optional($._newline), "]"),
        seq(
          "[",
          optional($._newline),
          commaSep1(optional($._newline), $.map_entry),
          optional(","),
          optional($._newline),
          "]",
        ),
      ),

    map_entry: ($) =>
      seq(
        field("key", $._expression),
        ":",
        optional($._newline),
        field("value", $._expression),
      ),

    // ====================================================================
    // 18. Strings
    // ====================================================================

    string: ($) =>
      seq(
        '"',
        repeat(choice($._string_content, $.escape, $.interpolation)),
        $._string_close,
      ),

    multiline_string: ($) =>
      seq(
        '"""',
        repeat(choice($._mstring_content, $.escape, $.interpolation)),
        $._mstring_close,
      ),

    escape: ($) => /\\["\\nrt#0]/,

    interpolation: ($) =>
      seq(
        "#{",
        $._expression,
        optional(seq(":", field("format", alias(FORMAT_SPEC, $.format_spec)))),
        "}",
      ),

    // ====================================================================
    // 19. Lexical
    // ====================================================================

    identifier: ($) => token(IDENT),

    type_identifier: ($) => token(TYPE_IDENT),

    // A `#` followed by `{` starts string interpolation, not a comment.
    // We disambiguate at the lexer level by only accepting comments that
    // are either a bare `#` (longest-match rules out interpolation
    // because `#{` is a longer literal) or `#` followed by a non-`{`
    // continuation.
    comment: ($) => token(choice("#", seq("#", /[^{\n][^\n]*/))),
  },
});

// ─────────────────────────────────────────────────────────────────────
// Grammar helpers
// ─────────────────────────────────────────────────────────────────────

// `fn name[<T>][(p)] [-> R]` — the prefix shared by every function-
// like declaration form (function_declaration, priv_function,
// extern_function_declaration, protocol_method). Returns an array of
// grammar fragments meant to be spread into the calling `seq(...)`
// call so the resulting state machine is flat (nested `seq` nodes
// can confuse tree-sitter's GLR exploration).
//
// The optional newline between `(...)` and `->` mirrors the
// reference lexer's `continues_line` rule (see expo-lexer) and lets
// long signatures wrap before the return arrow.
function fnHeader($) {
  return [
    "fn",
    field("name", $.identifier),
    optional(field("type_parameters", $.type_parameters)),
    optional(field("parameters", $.parameters)),
    optional($._newline),
    optional(field("return_type", $.return_type)),
  ];
}

// `[\n] [field=block] [\n]` — the tail used before any closer
// (`end`, `else`, ...) on block-bearing constructs. `block`
// deliberately does not consume its own trailing newline (see the
// comment on the `block` rule), so this helper is the canonical way
// to bridge between a block's last statement and the closing
// keyword in the surrounding rule. Returns an array (see `fnHeader`).
function blockBody($, fieldName = "body") {
  return [
    optional($._newline),
    optional(field(fieldName, $.block)),
    optional($._newline),
  ];
}

function commaSep(sep, rule) {
  return optional(commaSep1(sep, rule));
}

function commaSep1(sep, rule) {
  return seq(rule, repeat(seq(",", sep, rule)));
}

function sepBy1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}
