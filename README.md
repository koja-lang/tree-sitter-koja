# tree-sitter-koja

A [tree-sitter](https://tree-sitter.github.io) grammar for the [Koja programming language](../koja/).

The grammar is authored in `grammar.js` and translated mechanically from `../koja/grammar.ebnf`. The generated parser (`src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/parser.h`) and the hand-written external scanner (`src/scanner.c`) are committed so consumers can build the grammar without running the tree-sitter CLI.

## Regenerating

```sh
npm install
npx tree-sitter generate
```

## Consumers

- [`koja/editors/zed/koja/`](../koja/editors/zed/koja/) — Zed extension (references this directory via a `file://` git URL plus a pinned commit).
- Future Helix / Neovim / Vim integrations.
