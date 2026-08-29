import { defineConfig, globalIgnores } from "eslint/config";
import schoolhub from "@schoolhub/config/eslint";

export default defineConfig([
  ...schoolhub,
  globalIgnores(["playwright-report/**", "test-results/**", ".auth/**"]),
  {
    // Specs assert on the running app, so a bare `await expect(...)` with no
    // return value is the norm; and Playwright's own config is a default export.
    files: ["tests/**/*.spec.ts", "src/setup/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
]);
