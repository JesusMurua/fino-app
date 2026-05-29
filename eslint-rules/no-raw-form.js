/**
 * ESLint rule: no-raw-form
 *
 * Forbids `<form>` elements in `*.component.html` files outside an
 * explicit allow-list. Enforces the schema-driven forms pattern
 * (FDD-029 / FDD-030) — new forms MUST use `<app-dynamic-form>` from
 * `src/app/shared/forms` instead of hand-rolling a `<form>`.
 *
 * Config (in .eslintrc.json under the rule's options):
 *   "rulesdir/no-raw-form": ["error", { "allowList": [glob, glob, ...] }]
 *
 * Each entry in `allowList` is a glob pattern matched against the
 * absolute file path of the linted file. If any pattern matches, the
 * rule emits no errors for that file.
 *
 * Documentation: docs/FDD-030-forms-adoption-admin-users.md §4.4.
 */

'use strict';

/**
 * Glob matcher — supports double-star-slash (any path prefix,
 * optionally empty), double-star (any chars across separators),
 * single-star (any chars within a single segment), and literal
 * characters. Mirrors minimatch's double-star-slash shortcut so
 * patterns like 'something/double-star-slash/login/double-star-slash'
 * correctly match paths that have no dirs after 'login/'.
 * Dependency-free by design.
 */
function matchesGlob(filePath, pattern) {
  // Normalize Windows backslashes to forward slashes so globs authored
  // POSIX-style match files lint'd on Windows.
  const normalized = filePath.replace(/\\/g, '/');

  // Tokenize glob patterns FIRST to placeholder characters so that the
  // regex characters in the eventual replacements (like `.*`) are not
  // affected by the subsequent metachar-escape pass. `\x01`-`\x03` are
  // control chars that never appear in file paths or glob source.
  const tokenized = pattern
    .replace(/\\/g, '/')
    .replace(/\*\*\//g, '\x01')   // matches any path prefix (zero or more dirs)
    .replace(/\*\*/g, '\x02')     // matches anything across separators
    .replace(/\*/g, '\x03');      // matches anything within a single segment

  // Escape regex metachars on the remaining literal portions. Placeholders
  // pass through unaffected.
  const escaped = tokenized.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Substitute placeholders with their final regex fragments.
  const regexSrc = escaped
    .replace(/\x01/g, '(?:.*/)?')
    .replace(/\x02/g, '.*')
    .replace(/\x03/g, '[^/]*');

  return new RegExp('^.*' + regexSrc + '$').test(normalized);
}

module.exports = {
  meta: {
    type:    'problem',
    docs: {
      description: 'Forbid <form> outside the allow-list — use <app-dynamic-form> instead.',
      category:    'Best Practices',
      recommended: false,
    },
    schema: [
      {
        type:                 'object',
        additionalProperties: false,
        properties: {
          allowList: {
            type:  'array',
            items: { type: 'string' },
          },
        },
      },
    ],
    messages: {
      rawFormForbidden:
        '<form> is forbidden here. Use <app-dynamic-form> from src/app/shared/forms instead. ' +
        'File matched no entry in allowList. If this form is intentional, add an entry to ' +
        'the rule config with a rationale.',
    },
  },

  create(context) {
    const options   = context.options[0] || {};
    const allowList = Array.isArray(options.allowList) ? options.allowList : [];
    const filename  = context.getFilename();

    // Allow-listed files are skipped entirely — no visitors registered.
    if (allowList.some((glob) => matchesGlob(filename, glob))) {
      return {};
    }

    return {
      // @angular-eslint/template-parser emits element nodes typed as
      // `Element$1` with a `name` field. The `$1` in the visitor key
      // proved unreliable with ESLint 8.57's esquery resolver — using
      // a `*` visitor with explicit type guard inside works reliably
      // (debug confirmed `*` visits every node including Element$1).
      '*'(node) {
        if (node && node.type === 'Element$1' && node.name === 'form') {
          context.report({
            node,
            messageId: 'rawFormForbidden',
          });
        }
      },
    };
  },
};
