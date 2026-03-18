import o3rConfig from '@o3r/eslint-config';
import {
  defineConfig,
  globalIgnores,
} from 'eslint/config';
import globals from 'globals';
import jsonParser from 'jsonc-eslint-parser';

export default defineConfig([
  globalIgnores(
    ['out/', 'test-out/', 'dist/', 'test-dist/', '**/*.d.ts', 'node_modules/', 'lib/'],
    'prompt-registry/ignores'
  ),
  ...o3rConfig,
  {
    name: 'prompt-registry/report-unused-disable-directives',
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    }
  },
  {
    name: 'prompt-registry/typescript-type-checking',
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    name: 'prompt-registry/node-globals',
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        NodeJS: true
      }
    }
  },
  {
    name: 'prompt-registry/overrides',
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allow: ['unknown']
      }]
    }
  },
  {
    // TODO to be discussed and fixed in a future PRs
    name: 'prompt-registry/temporary-warn-rules-ts',
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-member-accessibility': 'warn',
      '@typescript-eslint/member-ordering': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/naming-convention': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-shadow': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn'
    }
  },
  {
    // TODO to be discussed and fixed in a future PRs
    name: 'prompt-registry/temporary-warn-rules',
    files: ['**/*.{j,t}s'],
    rules: {
      'unicorn/filename-case': 'warn',
      'unicorn/no-array-sort': 'warn',
      'unicorn/no-useless-switch-case': 'warn',
      'unicorn/prefer-single-call': 'warn',
      'unicorn/prefer-query-selector': 'warn',
      'unicorn/prefer-default-parameters': 'warn',
      'unicorn/prefer-number-properties': 'warn',
      'unicorn/prefer-ternary': 'warn',
      'unicorn/text-encoding-identifier-case': 'warn',
      'unicorn/explicit-length-check': 'warn',
      'unicorn/no-immediate-mutation': 'warn',
      'prefer-arrow/prefer-arrow-functions': 'warn',
      'jsdoc/check-tag-names': 'warn',
      'jsdoc/require-description': 'warn',
      'jsdoc/require-param-type': 'warn',
      'jsdoc/reject-any-type': 'warn',
      'jsdoc/escape-inline-tags': 'warn',
      'jsdoc/check-alignment': 'warn',
      'jsdoc/require-throws-type': 'warn',
      'no-underscore-dangle': 'warn',
      'no-console': 'warn',
      'no-undef': 'warn',
      'no-loop-func': 'warn',
      'no-bitwise': 'warn',
      'new-cap': 'warn',
      'prefer-const': 'warn',
      'import/no-cycle': 'warn',
      'import/order': 'warn',
      'import-newlines/enforce': 'warn',
      '@stylistic/max-statements-per-line': 'warn',
      '@stylistic/indent-binary-ops': 'warn',
      '@stylistic/comma-dangle': 'warn',
      '@stylistic/brace-style': 'warn',
      '@stylistic/max-len': 'warn',
      '@stylistic/semi': 'warn',
      '@stylistic/indent': 'warn',
      '@eslint-community/eslint-comments/require-description': 'warn'
    }
  },
  {
    name: 'prompt-registry/parser/json',
    files: ['**/*.json'],
    languageOptions: {
      parser: jsonParser
    }
  },
  {
    name: 'prompt-registry/settings',
    settings: {
      'import/resolver': {
        node: true,
        typescript: {
          projectService: true
        }
      }
    }
  },
  {
    name: 'prompt-registry/webview-js',
    files: ['src/ui/webview/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    }
  }
]);
