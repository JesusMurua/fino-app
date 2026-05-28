'use strict';

/**
 * ESLint config converted from .eslintrc.json to .cjs to support the
 * local custom rule `rulesdir/no-raw-form` (FDD-030 sub-phase c).
 *
 * The `eslint-plugin-rulesdir` plugin needs to be required at config
 * load time, which JSON doesn't allow. All other rules and overrides
 * are preserved verbatim from the previous .eslintrc.json.
 */

const rulesDirPlugin = require('eslint-plugin-rulesdir');

// Point the plugin at our local rules folder. The plugin uses this
// global path to resolve rules referenced as `rulesdir/<name>` below.
rulesDirPlugin.RULES_DIR = ['./eslint-rules'];

module.exports = {
  root: true,
  ignorePatterns: ['projects/**/*', 'eslint-rules/**/*'],
  overrides: [
    {
      files: ['*.ts'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@angular-eslint/recommended',
        'plugin:@angular-eslint/template/process-inline-templates',
      ],
      rules: {
        '@angular-eslint/directive-selector': [
          'error',
          { type: 'attribute', prefix: 'app', style: 'camelCase' },
        ],
        '@angular-eslint/component-selector': [
          'error',
          { type: 'element', prefix: 'app', style: 'kebab-case' },
        ],
        quotes: ['error', 'single'],
        semi: ['error', 'always'],
        'max-len': ['warn', { code: 140 }],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
    {
      files: ['*.html'],
      plugins: ['rulesdir'],
      extends: [
        'plugin:@angular-eslint/template/recommended',
        'plugin:@angular-eslint/template/accessibility',
      ],
      rules: {
        // FDD-030 sub-phase (c): forbid raw <form> in component templates
        // outside the explicit allow-list. New forms MUST use
        // <app-dynamic-form> from src/app/shared/forms.
        //
        // Allow-list rationale templates per FDD-030 step 0.5:
        //   (i)   "Auth surface — defer migration indefinitely (low ROI)"
        //   (ii)  "Pending FDD-XXX migration" (consumer scheduled)
        //   (iii) "Legacy POC — survives until template migrates"
        //   (iv)  "Search/filter input — not a form per se" (rare exception)
        'rulesdir/no-raw-form': [
          'error',
          {
            allowList: [
              // (i) Auth surfaces — defer indefinitely (low ROI / isolated)
              '**/login/**/*.component.html',
              '**/register/**/*.component.html',
              '**/pin/**/*.component.html',

              // (iii) Legacy POC — survives until template migrates
              '**/product-form/**/*.component.html',

              // (ii) Pending future migration (smaller form, low priority).
              //      Folder is `promotions/`, file is `admin-promotions.component.html`.
              '**/admin-promotions.component.html',

              // (ii) Pending future migration (POS kiosk flows — different UX scope)
              '**/kiosk/**/*.component.html',

              // (ii) Pending future migration (POS surface, F2 was admin-only)
              '**/product-detail/**/*.component.html',
            ],
          },
        ],
      },
    },
  ],
};
