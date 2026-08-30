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
  ...tseslint.configs.recommended,
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
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Tests may reach for looser typing when building fixtures.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/jest.setup.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Last, per nextjs.org/docs/app/api-reference/config/eslint#with-prettier: turns off
  // every formatting-related core/TS rule so ESLint and Prettier never disagree. A config
  // spread after this one (as apps/*/eslint.config.mjs do, putting `...schoolhub` last)
  // still wins for any of its own rules — only THIS config's ordering matters.
  prettier,
);
