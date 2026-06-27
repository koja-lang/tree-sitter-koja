# tree-sitter-koja

[![CI](https://github.com/koja-lang/tree-sitter-koja/actions/workflows/ci.yml/badge.svg)](https://github.com/koja-lang/tree-sitter-koja/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/koja-lang/tree-sitter-koja)](https://github.com/koja-lang/tree-sitter-koja/releases)
[![Last Updated](https://img.shields.io/github/last-commit/koja-lang/tree-sitter-koja.svg)](https://github.com/koja-lang/tree-sitter-koja/commits/main)

A [tree-sitter](https://tree-sitter.github.io) grammar for the [Koja programming language](https://github.com/koja-lang/koja). It powers syntax highlighting, code folding, and structural editing in editors that speak tree-sitter.

## Editor support

You probably want an editor integration rather than the raw grammar:

- **Zed** — install [**zed-koja**](https://github.com/koja-lang/zed-koja), the official Koja extension. It pairs this grammar with the `koja-lsp` language server for rich highlighting, an outline view, bracket matching, and live diagnostics. This is the recommended way to write Koja in an editor today.
- **Helix / Neovim / Vim** — planned; these consume the grammar in this repository directly.

## Contributing

The grammar is authored in `grammar.js`, translated mechanically from Koja's [`grammar.ebnf`](https://github.com/koja-lang/koja/blob/main/grammar.ebnf). The generated parser (`src/parser.c`, `src/grammar.json`, `src/node-types.json`) and the custom external scanner (`src/scanner.c`) are committed so consumers can build the grammar without the tree-sitter CLI.

After editing `grammar.js`, regenerate the committed parser:

```sh
npm install
npx tree-sitter generate
```

Highlight queries live in `queries/highlights.scm`.
