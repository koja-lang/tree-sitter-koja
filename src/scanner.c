// External scanner for tree-sitter-koja.
//
// Emits these context-sensitive tokens:
//   _newline            significant statement terminator
//   _line_continuation  zero-width token emitted instead of _newline when
//                       the next line starts with `.` / `?` / `:` (method
//                       chain or ternary continuation) or the word `and` /
//                       `or` (wrapped boolean chain). The grammar discards
//                       it via `extras`.
//   _string_content     a non-empty run of regular characters inside "..."
//   _mstring_content    a non-empty run of regular characters inside """..."""
//   _string_close       closing `"` of a single-line string
//   _mstring_close      closing `"""` of a multiline string
//
// Approach:
//   * Newlines are emitted only when the parser asks for one (i.e. when
//     `_newline` is in `valid_symbols`). The scanner consumes any number of
//     blank lines and surrounding whitespace before deciding to emit.
//     This mirrors the suppression rules in `koja/crates/koja-lexer/`:
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
  LINE_CONTINUATION,
  STRING_CONTENT,
  MSTRING_CONTENT,
  STRING_CLOSE,
  MSTRING_CLOSE,
};

void *tree_sitter_koja_external_scanner_create(void) { return NULL; }
void tree_sitter_koja_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_koja_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}
void tree_sitter_koja_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

// True if `c` can continue an identifier (`and_more`, `or_else`, `and?`).
static inline bool is_ident_char(int32_t c) {
  return iswalnum(c) || c == '_' || c == '?' || c == '!';
}

// True if the lexer sits at the word `and` or `or` at a word boundary.
// Advances the lexer past the match. The caller must have already called
// mark_end so the consumed characters stay lookahead-only.
static bool peek_leading_bool_operator(TSLexer *lexer) {
  if (lexer->lookahead == 'o') {
    advance(lexer);
    if (lexer->lookahead != 'r') return false;
    advance(lexer);
    return !is_ident_char(lexer->lookahead);
  }
  if (lexer->lookahead == 'a') {
    advance(lexer);
    if (lexer->lookahead != 'n') return false;
    advance(lexer);
    if (lexer->lookahead != 'd') return false;
    advance(lexer);
    return !is_ident_char(lexer->lookahead);
  }
  return false;
}

// Consume any number of newlines surrounded by whitespace. When
// `valid_symbols[NEWLINE]` is true and we saw at least one `\n`, emit the
// NEWLINE token; otherwise the newlines are silently dropped (treated as
// whitespace) and we fall through to the default tokenizer.
//
// A comment line does not terminate a statement by itself, and the
// terminator must be emitted after the last comment so a run of comment
// lines separates two statements with exactly one NEWLINE. When the scan
// lands on `#` we therefore emit a zero-width LINE_CONTINUATION (an
// extra the grammar discards), let the internal lexer surface the
// comment as a `comment` node, and resume the newline scan afterwards.
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
    if (lexer->lookahead == '#' && saw_newline) {
      if (valid_symbols[LINE_CONTINUATION]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = LINE_CONTINUATION;
        return true;
      }
      // No room for the extra at this state, so absorb the comment the
      // way the pre-0.2.0 scanner always did and keep scanning.
      while (lexer->lookahead != 0 && lexer->lookahead != '\n') {
        skip(lexer);
      }
      continue;
    }
    break;
  }
  if (!saw_newline) {
    return false;
  }
  // Both outcomes below are zero-width tokens ending here, before any
  // lookahead peeking past the line start.
  lexer->mark_end(lexer);
  // Mirror the reference parser's continuation lookahead: a line that
  // starts with `.` continues a method chain, `?` / `:` continue a
  // ternary (`cond\n  ? a\n  : b`), and the word `and` / `or` continues
  // a wrapped boolean chain. No statement can *begin* with those, so the
  // newline is whitespace. We can't just return false here, because
  // tree-sitter would then re-lex from the bare `\n`, which the internal
  // lexer can't skip. Instead we emit a zero-width LINE_CONTINUATION
  // token that the grammar discards via `extras`.
  bool continues = lexer->lookahead == '.' || lexer->lookahead == '?' ||
                   lexer->lookahead == ':' || peek_leading_bool_operator(lexer);
  if (continues) {
    if (valid_symbols[LINE_CONTINUATION]) {
      lexer->result_symbol = LINE_CONTINUATION;
      return true;
    }
    return false;
  }
  if (valid_symbols[NEWLINE]) {
    lexer->result_symbol = NEWLINE;
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

bool tree_sitter_koja_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
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
