# tree-sitter-expo

A [tree-sitter](https://tree-sitter.github.io) grammar for the [Expo programming language](../expo/).

The grammar is authored in `grammar.js` and translated mechanically from `../expo/grammar.ebnf`. The generated parser (`src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/parser.h`) and the hand-written external scanner (`src/scanner.c`) are committed so consumers can build the grammar without running the tree-sitter CLI.

## Regenerating

```sh
npm install
npx tree-sitter generate
```

## Consumers

- [`expo/editors/zed/expo/`](../expo/editors/zed/expo/) — Zed extension (references this directory via a `file://` git URL plus a pinned commit).
- Future Helix / Neovim / Vim integrations.
