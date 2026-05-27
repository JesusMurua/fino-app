/**
 * Spec for the `no-raw-form` ESLint rule.
 *
 * Runs via mocha (installed as devDep for this rule):
 *   npx mocha eslint-rules/no-raw-form.spec.js
 *
 * Uses ESLint's built-in `RuleTester`, which emits mocha-compatible
 * `describe`/`it` blocks via the global registered by mocha.
 */

'use strict';

const { RuleTester } = require('eslint');
const rule           = require('./no-raw-form');

const tester = new RuleTester({
  // Use @angular-eslint/template-parser so the AST emits `Element$1`
  // nodes the rule visits. Same parser used in .eslintrc.json for
  // *.html overrides.
  parser: require.resolve('@angular-eslint/template-parser'),
});

const allowedFilePath   = '/abs/project/src/app/modules/login/login.component.html';
const forbiddenFilePath = '/abs/project/src/app/modules/admin/components/customers/admin-customers.component.html';

tester.run('no-raw-form', rule, {
  valid: [
    {
      name:     'no <form> at all in the template',
      code:     '<div><h1>Hello</h1></div>',
      filename: forbiddenFilePath,
    },
    {
      name:     '<app-dynamic-form> instead of <form>',
      code:     '<app-dynamic-form [schema]="s" [formGroup]="g" />',
      filename: forbiddenFilePath,
    },
    {
      name:     '<form> in an allow-listed file',
      code:     '<form><input /></form>',
      filename: allowedFilePath,
      options:  [{ allowList: ['**/login/**/*.component.html'] }],
    },
    {
      name:     '<form> in a deep nested allow-listed file',
      code:     '<form></form>',
      filename: '/abs/src/app/modules/kiosk/screens/welcome/kiosk-welcome.component.html',
      options:  [{ allowList: ['**/kiosk/**/*.component.html'] }],
    },
  ],

  invalid: [
    {
      name:     '<form> in a file outside allow-list',
      code:     '<form><input /></form>',
      filename: forbiddenFilePath,
      options:  [{ allowList: [] }],
      errors:   [{ messageId: 'rawFormForbidden' }],
    },
    {
      name:     'empty allow-list defaults to forbid all (no options provided)',
      code:     '<form></form>',
      filename: forbiddenFilePath,
      errors:   [{ messageId: 'rawFormForbidden' }],
    },
    {
      name:     '<form> in file that does NOT match any allow-list glob',
      code:     '<form></form>',
      filename: forbiddenFilePath,
      options:  [{ allowList: ['**/login/**/*.component.html'] }],
      errors:   [{ messageId: 'rawFormForbidden' }],
    },
  ],
});

// Note: Angular's HTML parser does NOT emit element nodes for
// self-closing tags on non-void elements (e.g. `<form />`). Such input
// is invalid HTML — the lint rule relies on the parser's element AST.
// Real-world `<form>` usage is always paired (`<form>...</form>`).
