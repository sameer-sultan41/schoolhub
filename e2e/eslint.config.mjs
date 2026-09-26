import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import schoolhub from "@schoolhub/config/eslint";
import warningsAsErrors from "@schoolhub/config/eslint-warnings-as-errors";
import {
  PLAYWRIGHT_DIRECT,
  PROCESS_ENV,
  restrictedImports,
  restrictedSyntax,
} from "@schoolhub/config/eslint-boundaries";

// Existing violations are frozen in ./eslint-suppressions.json, which may only shrink (ADR-0014).
export default warningsAsErrors(
  defineConfig([
    ...schoolhub,
    globalIgnores(["playwright-report/**", "test-results/**", ".auth/**"]),
    {
      // Plain Node scripts, not part of the app's TS project — the shared config has no
      // Node globals since every other workspace here is browser-only Next.js code.
      files: ["scripts/**/*.mjs"],
      languageOptions: { globals: globals.node },
    },
    restrictedImports(["tests/**"], [PLAYWRIGHT_DIRECT]),
    // Configuration comes from the validated src/env.ts (loaded by src/load-env.ts), not
    // process.env scattered through specs (ADR-0014).
    restrictedSyntax(["tests/**/*.ts", "src/**/*.ts"], [PROCESS_ENV], {
      ignores: ["src/env.ts", "src/load-env.ts"],
    }),
  ]),
);
