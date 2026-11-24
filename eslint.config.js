// Lint + formatting rules. Formatting is done by @stylistic instead of Prettier because
// Prettier can't put opening braces on their own line (Allman style), which this project uses.
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";
import allmanTypeBraces from "./eslint-rules/allman-type-braces.js";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "test-results/", "playwright-report/"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts", "**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "@stylistic": stylistic, local: { rules: { "allman-type-braces": allmanTypeBraces } } },
    rules: {
      // ---------- Braces: opening brace on its own line ----------
      "@stylistic/brace-style": ["error", "allman", { allowSingleLine: false }],
      "local/allman-type-braces": "error",
      curly: ["error", "multi-line"],

      // ---------- Code in paragraphs: a blank line between steps ----------
      "@stylistic/padding-line-between-statements": [
        "error",
        // Rules are applied in order; later rules override earlier ones for the same pair.
        // Around blocks (if/for/while/try/switch with braces, functions, classes)
        { blankLine: "always", prev: "*", next: "block-like" },
        { blankLine: "always", prev: "block-like", next: "*" },
        // A declaration starts a new step, and the code that uses it starts another...
        { blankLine: "always", prev: "*", next: ["const", "let"] },
        { blankLine: "always", prev: ["const", "let"], next: "*" },
        // ...but a run of declarations stays together as one step
        { blankLine: "any", prev: ["const", "let"], next: ["const", "let"] },
        // Before returning
        { blankLine: "always", prev: "*", next: "return" },
        // Imports are one group, separated from the code below
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
      ],
      "@stylistic/lines-between-class-members": ["error", "always", { exceptAfterSingleLine: true }],
      "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],

      // ---------- Everyday formatting ----------
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/eol-last": ["error", "always"],
      "@stylistic/no-trailing-spaces": "error",

      // ---------- Correctness ----------
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
