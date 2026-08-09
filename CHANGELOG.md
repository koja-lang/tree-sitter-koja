# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-09

### Added

- Conformance headers on `struct` and `enum` declarations (`struct App: Process<C, M, R>, Debug`), including wrapped protocol lists.
- `builtin` declaration kind for compiler-owned types (`builtin String ... end`), with keyword highlighting.

### Changed

- Removed the `Pair` example from the corpus after its removal from the language.

## [0.3.0] - 2026-08-03

### Added

- Anonymous tuples, covering tuple expressions, `(A, B)` tuple types, `match` patterns, and `(x, y) = pair` destructuring assignment.
- Nested type declarations inside a `struct` or `enum` body.
- Error channel support, covering `try`, `fail`, and `rescue` expressions plus `! E` error types in function and protocol-method signatures (`-> T ! E`, or a bare `! E` for a unit success).
- A line starting with `rescue` now continues the previous expression, matching the formatter's wrapped rescue-tail style.

## [0.2.0] - 2026-07-10

### Added

- `priv` is now accepted on `struct`, `enum`, `const`, `type`, and `protocol` declarations.
- A line starting with `and` or `or` now continues the previous expression, matching the formatter's leading-operator style for wrapped boolean chains.
- `struct` and `enum` declarations accept dotted nested-type names (`struct Process.CrashInfo`).

### Fixed

- Enum patterns with multi-segment type paths (`Process.StopReason.Normal`) now parse.
- Comments now appear in the syntax tree instead of being absorbed by newline handling, so comment highlighting works.
- A match or cond arm following a multi-statement arm body now parses as a new arm instead of a short closure extending the previous body.

## [0.1.1] - 2026-06-27

### Changed

- Disabled the unused language bindings (`c`, `go`, `node`, `python`, `rust`, `swift`).

### Fixed

- Removed an invalid `main` field in `package.json` that pointed at a nonexistent `bindings/node`.

## [0.1.0] - 2026-06-10

Initial public release, tracking Koja 0.12.0 syntax.

[unreleased]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/koja-lang/tree-sitter-koja/releases/tag/v0.1.0
