
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/artifacts/**',
      '**/cache/**',
      '**/node_modules/**',
      '**/coverage/**',
      'frontend/dist/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
    },
    rules: {
      'no-unused-vars': ['warn', {
        args: 'all',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
