import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["artifacts/**", "cache/**", "node_modules/**", "coverage/**"],
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tsParser,
    },
    rules: {
      "no-unused-vars": "warn",
    },
  },
];