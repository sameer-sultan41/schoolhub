import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

/**
 * Shared ESLint flat config for every workspace in the monorepo.
 * Apps extend this and add their framework plugins (e.g. `eslint-config-next`).
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description" },
      ],
      // strictTypeChecked's default flags every non-string interpolation, including a
      // plain `number` — but interpolating a number is exactly as safe as a string;
      // there is no NaN/[object Object] risk the rule is protecting against. Fired
      // identically in 4 unrelated files across this codebase (HTTP status codes, byte
      // counts), each a legitimate case — a config-level allowance, not 4 `.toString()` calls.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Jest tests only — not e2e/**/*.spec.ts, deliberately. This carve-out exists for one
    // specific, known limitation: jest.fn()'s generic does not survive chaining through
    // its own fluent mock methods (e.g. `jest.fn<T>().mockResolvedValue(x)` infers back to
    // `Mock<any, any, any>`, a known @types/jest limitation, not a real gap in this
    // codebase), so every `.mock.calls[n][m]` access on a mocked function is `any`
    // regardless of how carefully the mock is typed. The e2e suite has no jest.fn()
    // anywhere — its mocking is the hand-typed MockApi in e2e/src/mocks/, not a jest
    // mock — so it does not have this problem and is intentionally held to the full
    // strict bar. Widening this glob to include .spec.ts would silently weaken that for
    // no reason tied to an actual limitation.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/jest.setup.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Scoped to exactly the rules that fire on the jest.fn() limitation above, not the
      // whole no-unsafe-* family, so a genuine `any` leaking through test logic itself is
      // still caught.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  // Must come after every type-aware rule setting above (strictTypeChecked's spread, the
  // custom-rules block, the test carve-out) — flat config lets a later, unscoped config
  // re-enable a rule an earlier, narrower one turned off for the same files. Putting this
  // first once put it under the custom-rules block below, silently re-enabling every
  // type-aware rule (restrict-template-expressions included) for .mjs files again.
  { files: ["**/*.mjs", "**/jest.setup.ts"], ...tseslint.configs.disableTypeChecked },
  // Last, per nextjs.org/docs/app/api-reference/config/eslint#with-prettier: turns off
  // every formatting-related core/TS rule so ESLint and Prettier never disagree. A config
  // spread after this one (as apps/*/eslint.config.mjs do, putting `...schoolhub` last)
  // still wins for any of its own rules — only THIS config's ordering matters.
  prettier,
);
