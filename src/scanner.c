// External scanner for tree-sitter-expo.
//
// Emits four context-sensitive tokens:
//   _newline           significant statement terminator
//   _string_content    a non-empty run of regular characters inside "..."
//   _mstring_content   a non-empty run of regular characters inside """..."""
//   _string_close      closing `"` of a single-line string
//   _mstring_close     closing `"""` of a multiline string
//
// Approach:
//   * Newlines are emitted only when the parser asks for one (i.e. when
//     `_newline` is in `valid_symbols`). The scanner consumes any number of
//     blank lines and surrounding whitespace before deciding to emit.
//     This mirrors the suppression rules in `expo/crates/expo-lexer/`:
//     because the grammar consumes `_newline` only at statement boundaries,
//     newlines that appear after operators / commas / inside parentheses
//     are simply skipped via `extras`.
//   * String content is consumed character-by-character, stopping at
//     `"`, `\\`, `#{`, or end-of-input (and at `\n` for single-line
//     strings). The closing `"` / `"""` is consumed by the dedicated
//     `_string_close` / `_mstring_close` token so the parser can attach
//     it as a structural marker.

#include "tree_sitter/parser.h"

#include <string.h>
#include <wctype.h>

enum TokenType {
  NEWLINE,
  STRING_CONTENT,
  MSTRING_CONTENT,
  STRING_CLOSE,
  MSTRING_CLOSE,
};

void *tree_sitter_expo_external_scanner_create(void) { return NULL; }
void tree_sitter_expo_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_expo_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}
void tree_sitter_expo_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

// Consume any number of newlines surrounded by whitespace and `#` line
// comments. When `valid_symbols[NEWLINE]` is true and we saw at least one
// `\n`, emit the NEWLINE token; otherwise the newlines are silently
// dropped (treated as whitespace) and we fall through to the default
// tokenizer.
static bool scan_newline(TSLexer *lexer, const bool *valid_symbols) {
  bool saw_newline = false;
  for (;;) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') {
      skip(lexer);
    }
    if (lexer->lookahead == '\n') {
      skip(lexer);
      saw_newline = true;
      continue;
    }
    if (lexer->lookahead == '#') {
      // Comment: consume to end of line, then loop to absorb the `\n`.
      while (lexer->lookahead != 0 && lexer->lookahead != '\n') {
        skip(lexer);
      }
      continue;
    }
    break;
  }
  if (saw_newline && valid_symbols[NEWLINE]) {
    lexer->result_symbol = NEWLINE;
    lexer->mark_end(lexer);
    return true;
  }
  return false;
}

// Scan single-line string content (between `"` and `"`).
// Stops at `"`, `\\`, `#{`, `\n`, or EOF.
static bool scan_string_content(TSLexer *lexer) {
  bool consumed = false;
  while (lexer->lookahead != 0) {
    if (lexer->lookahead == '"' || lexer->lookahead == '\\' || lexer->lookahead == '\n') {
      break;
    }
    if (lexer->lookahead == '#') {
      // Peek for `#{` interpolation start — handled by the grammar.
      lexer->mark_end(lexer);
      advance(lexer);
      if (lexer->lookahead == '{') {
        // Already consumed the `#`; abort if we hadn't consumed anything else,
        // otherwise return content up to (but not including) the `#`.
        if (!consumed) {
          return false;
        }
        // Treat the just-consumed `#` as part of nothing — back up by leaving
        // mark_end at the position before `#`.
        lexer->result_symbol = STRING_CONTENT;
        return true;
      }
      consumed = true;
      continue;
    }
    advance(lexer);
    consumed = true;
  }
  if (consumed) {
    lexer->mark_end(lexer);
    lexer->result_symbol = STRING_CONTENT;
    return true;
  }
  return false;
}

// Scan multiline string content (between `"""` and `"""`).
// Stops at `"""`, `\\`, `#{`, or EOF. Newlines are part of the content.
static bool scan_mstring_content(TSLexer *lexer) {
  bool consumed = false;
  while (lexer->lookahead != 0) {
    if (lexer->lookahead == '\\') {
      break;
    }
    if (lexer->lookahead == '#') {
      lexer->mark_end(lexer);
      advance(lexer);
      if (lexer->lookahead == '{') {
        if (!consumed) {
          return false;
        }
        lexer->result_symbol = MSTRING_CONTENT;
        return true;
      }
      consumed = true;
      continue;
    }
    if (lexer->lookahead == '"') {
      lexer->mark_end(lexer);
      advance(lexer);
      if (lexer->lookahead == '"') {
        advance(lexer);
        if (lexer->lookahead == '"') {
          // Found `"""` — stop here; the close token will consume it.
          if (!consumed) {
            return false;
          }
          lexer->result_symbol = MSTRING_CONTENT;
          return true;
        }
      }
      consumed = true;
      continue;
    }
    advance(lexer);
    consumed = true;
  }
  if (consumed) {
    lexer->mark_end(lexer);
    lexer->result_symbol = MSTRING_CONTENT;
    return true;
  }
  return false;
}

static bool scan_string_close(TSLexer *lexer) {
  if (lexer->lookahead != '"') return false;
  advance(lexer);
  lexer->result_symbol = STRING_CLOSE;
  lexer->mark_end(lexer);
  return true;
}

static bool scan_mstring_close(TSLexer *lexer) {
  if (lexer->lookahead != '"') return false;
  advance(lexer);
  if (lexer->lookahead != '"') return false;
  advance(lexer);
  if (lexer->lookahead != '"') return false;
  advance(lexer);
  lexer->result_symbol = MSTRING_CLOSE;
  lexer->mark_end(lexer);
  return true;
}

bool tree_sitter_expo_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;

  // Inside a string body the relevant tokens are *_content / *_close.
  // Closes must be tried before content scanners because the content
  // scanners refuse to consume zero characters; if we accidentally
  // tried content first when the next characters are a close
  // sequence, the content scanner could leave the lexer in a bad
  // state on some inputs.
  if (valid_symbols[MSTRING_CLOSE] && scan_mstring_close(lexer)) {
    return true;
  }
  if (valid_symbols[STRING_CLOSE] && scan_string_close(lexer)) {
    return true;
  }
  if (valid_symbols[MSTRING_CONTENT] && scan_mstring_content(lexer)) {
    return true;
  }
  if (valid_symbols[STRING_CONTENT] && scan_string_content(lexer)) {
    return true;
  }

  // Newline handling runs unconditionally so that newlines outside of
  // statement-terminator context get silently absorbed as whitespace.
  if (scan_newline(lexer, valid_symbols)) {
    return true;
  }

  return false;
}
