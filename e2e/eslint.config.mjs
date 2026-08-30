import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import schoolhub from "@schoolhub/config/eslint";

export default defineConfig([
  ...schoolhub,
  globalIgnores(["playwright-report/**", "test-results/**", ".auth/**"]),
  {
    // Plain Node scripts, not part of the app's TS project — the shared config has no
    // Node globals since every other workspace here is browser-only Next.js code.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
]);
