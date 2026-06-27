# tree-sitter-koja

A [tree-sitter](https://tree-sitter.github.io) grammar for the [Koja programming language](https://github.com/koja-lang/koja).

The grammar is authored in `grammar.js` and translated mechanically from Koja's [`grammar.ebnf`](https://github.com/koja-lang/koja/blob/main/grammar.ebnf). The generated parser (`src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/parser.h`) and the custom external scanner (`src/scanner.c`) are committed so consumers can build the grammar without running the tree-sitter CLI.

Standard highlight queries live in `queries/highlights.scm`.

## Regenerating

```sh
npm install
npx tree-sitter generate
```

## Consumers

- [Koja's Zed extension](https://github.com/koja-lang/zed-koja) — references this repository with a pinned commit.
- Future Helix / Neovim / Vim integrations.
