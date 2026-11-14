// Shared ESLint flat config for every package in the monorepo.
//
// Baseline: Google TypeScript Style (gts). gts 7 pins ESLint 9, which is no
// longer supported and is incompatible with the eslint-plugin-astro release
// that supports Astro 7, so the gts rules are applied here by hand. The
// deviation is recorded in the README.

import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import prettier from 'eslint-config-prettier';
import astro from 'eslint-plugin-astro';
import {importX} from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts', '**/*.tsx'];
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'];

/** Rules that gts 7 applies on top of eslint:recommended. */
const gtsRules = {
  'block-scoped-var': 'error',
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  'prefer-arrow-callback': 'error',
  'no-restricted-properties': [
    'error',
    {object: 'describe', property: 'only'},
    {object: 'it', property: 'only'},
    {object: 'test', property: 'only'},
  ],
};

/** Project code rules from the system overview. */
const projectTypeScriptRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    {assertionStyle: 'never'},
  ],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
  '@typescript-eslint/explicit-function-return-type': [
    'error',
    {allowExpressions: true, allowTypedFunctionExpressions: true},
  ],
  '@typescript-eslint/prefer-readonly': 'error',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    {prefer: 'type-imports', fixStyle: 'separate-type-imports'},
  ],
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/restrict-template-expressions': [
    'error',
    {allowNumber: true},
  ],
  'no-restricted-syntax': [
    'error',
    {selector: 'TSEnumDeclaration', message: 'Do not use enum.'},
    {selector: 'TSModuleDeclaration', message: 'Do not use namespace.'},
  ],
};

/**
 * Builds the shared config.
 * @param {{tsconfigRootDir: string}} options Absolute path of the repo root.
 * @returns {import('eslint').Linter.Config[]} The flat config array.
 */
export function createConfig({tsconfigRootDir}) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.astro/**',
        '**/coverage/**',
        '**/.cache/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/.lighthouseci/**',
      ],
    },
    js.configs.recommended,
    {
      linterOptions: {reportUnusedDisableDirectives: 'error'},
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: globals.node,
      },
      rules: gtsRules,
    },

    // Every eslint-disable comment needs a written reason.
    comments.recommended,
    {
      rules: {
        '@eslint-community/eslint-comments/require-description': [
          'error',
          {ignore: []},
        ],
      },
    },

    // Imports: ordering, no unused, no cycles, named exports only.
    {
      plugins: {'import-x': importX, 'unused-imports': unusedImports},
      settings: {
        'import-x/resolver': {typescript: true, node: true},
      },
      rules: {
        'import-x/order': [
          'error',
          {
            groups: [
              'builtin',
              'external',
              'internal',
              'parent',
              'sibling',
              'index',
            ],
            'newlines-between': 'always',
            alphabetize: {order: 'asc', caseInsensitive: true},
          },
        ],
        'import-x/no-cycle': 'error',
        'import-x/no-default-export': 'error',
        'import-x/no-duplicates': 'error',
        'unused-imports/no-unused-imports': 'error',
        'unused-imports/no-unused-vars': [
          'error',
          {args: 'after-used', argsIgnorePattern: '^_'},
        ],
      },
    },

    // TypeScript: strict, type-checked.
    {
      files: TS_FILES,
      extends: [
        ...tseslint.configs.strictTypeChecked,
        ...tseslint.configs.stylisticTypeChecked,
      ],
      languageOptions: {
        parserOptions: {
          projectService: {
            // Tool config files are not part of any package's project.
            allowDefaultProject: ['*.config.ts', 'apps/*/*.config.ts'],
          },
          tsconfigRootDir,
        },
      },
      rules: projectTypeScriptRules,
    },

    // Boundary rule: the web app and the backend must not import each other.
    // Both may import the contracts package only.
    {
      files: ['apps/web/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/apps/backend/**',
                  '**/backend/src/**',
                  '@mvi/backend*',
                ],
                message:
                  'apps/web must not import from apps/backend. Use @mvi/contracts.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['apps/backend/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/apps/web/**', '**/web/src/**', 'web', 'web/*'],
                message:
                  'apps/backend must not import from apps/web. Use @mvi/contracts.',
              },
            ],
          },
        ],
      },
    },

    // Scoring is pure: no file access, network, clock or randomness.
    {
      files: ['apps/backend/src/scoring/**/*.ts'],
      ignores: ['**/*.test.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  'node:*',
                  '**/io/**',
                  '**/collect/**',
                  '**/apps/web/**',
                ],
                message: 'Scoring must stay pure: no I/O and no Node.js APIs.',
              },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          {name: 'Date', message: 'Scoring must not read the clock.'},
          {name: 'fetch', message: 'Scoring must not use the network.'},
          {
            name: 'process',
            message: 'Scoring must not read the environment.',
          },
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'random',
            message: 'Scoring must not use randomness.',
          },
        ],
      },
    },

    // Web app: Astro components and the Preact island.
    ...astro.configs['flat/recommended'],
    ...astro.configs['flat/jsx-a11y-strict'],
    {
      files: ['apps/web/**/*.tsx'],
      ...jsxA11y.flatConfigs.strict,
      languageOptions: {
        ...jsxA11y.flatConfigs.strict.languageOptions,
        globals: globals.browser,
      },
    },
    {
      files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
      languageOptions: {globals: globals.browser},
    },
    {
      files: ['**/*.astro'],
      languageOptions: {
        parserOptions: {
          parser: tseslint.parser,
          extraFileExtensions: ['.astro'],
        },
      },
    },

    // Default exports only where a tool requires one.
    {
      files: [
        '**/*.config.js',
        '**/*.config.ts',
        '**/*.config.mjs',
        '**/*.astro',
      ],
      rules: {'import-x/no-default-export': 'off'},
    },

    // Plain JavaScript config files are not part of a TypeScript project.
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      extends: [tseslint.configs.disableTypeChecked],
    },

    // Tests may build partial objects and call non-exported helpers freely.
    {
      files: TEST_FILES,
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },

    // Prettier owns formatting. This must stay last.
    prettier,
  );
}
