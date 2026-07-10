# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-10

Tracks the syntax of the upcoming Koja release. The grammar remains a strict superset of earlier releases, so all Koja 0.13 sources parse unchanged.

### Added

- `priv` is now accepted on `struct`, `enum`, `const`, `type`, and `protocol` declarations.
- A line starting with `and` or `or` now continues the previous expression, matching the formatter's leading-operator style for wrapped boolean chains.
- `struct` and `enum` declarations accept dotted nested-type names (`struct Process.CrashInfo`).
- Test corpus covering visibility modifiers and line continuation, plus stdlib parse verification.

### Fixed

- Enum patterns with multi-segment type paths (`Process.StopReason.Normal`) now parse.

## [0.1.1] - 2026-06-27

### Changed

- Disabled the unused language bindings (`c`, `go`, `node`, `python`, `rust`, `swift`).

### Fixed

- Removed an invalid `main` field in `package.json` that pointed at a nonexistent `bindings/node`.

## [0.1.0] - 2026-06-10

Initial public release, tracking Koja 0.12.0 syntax.

[unreleased]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/koja-lang/tree-sitter-koja/releases/tag/v0.1.0
