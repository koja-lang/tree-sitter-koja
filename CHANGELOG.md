# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-06-27

### Changed

- Disabled the unused language bindings (`c`, `go`, `node`, `python`, `rust`, `swift`).

### Fixed

- Removed an invalid `main` field in `package.json` that pointed at a nonexistent `bindings/node`.

## [0.1.0] - 2026-06-10

Initial public release, tracking Koja 0.12.0 syntax.

[unreleased]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/koja-lang/tree-sitter-koja/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/koja-lang/tree-sitter-koja/releases/tag/v0.1.0
