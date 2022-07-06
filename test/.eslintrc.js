'use strict';

module.exports = {
  'extends': ['plugin:jest/recommended', 'plugin:jest/style'],
  env: { 'jest/globals': true },
  rules: {
    'jest/no-conditional-in-test': 'warn',
    'jest/no-duplicate-hooks': 'warn',
    'jest/prefer-comparison-matcher': 'warn',
    'jest/prefer-equality-matcher': 'warn',
    'jest/prefer-expect-assertions': 'warn',
    'jest/prefer-expect-resolves': 'error',
    'jest/prefer-hooks-in-order': 'error',
    'jest/prefer-hooks-on-top': 'error',
    'jest/prefer-spy-on': 'warn',
    'jest/prefer-strict-equal': 'warn',
    'jest/require-hook': 'warn',
    'jest/require-top-level-describe': 'error',
    'sonarjs/no-duplicate-string': 'off',
    'node/no-unpublished-require': 'off',
  }
};
