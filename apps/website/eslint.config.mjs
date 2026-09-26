import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import schoolhub from "@schoolhub/config/eslint";
import warningsAsErrors from "@schoolhub/config/eslint-warnings-as-errors";
import {
  PARENT_RELATIVE,
  PHYSICAL_DIRECTION,
  PROCESS_ENV,
  REACT_COMPILER_ONLY_RULES_OFF,
  TEST_FILES,
  maxLines,
  restrictedImports,
  restrictedSyntax,
} from "@schoolhub/config/eslint-boundaries";

// Existing violations are frozen in ./eslint-suppressions.json, which may only shrink
// (ADR-0014). No react/jsx-no-literals here: website-builder.md sets no i18n requirement for
// the renderer's chrome.
const eslintConfig = warningsAsErrors(
  defineConfig([
    ...nextVitals,
    ...nextTs,
    ...schoolhub,
    REACT_COMPILER_ONLY_RULES_OFF,
    restrictedImports(["src/**"], [PARENT_RELATIVE]),
    {
      // Tests import their own module one level up ("../foo") — the established convention.
      files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
      rules: { "no-restricted-imports": "off" },
    },
    restrictedSyntax(["src/**/*.{ts,tsx}"], [PROCESS_ENV, ...PHYSICAL_DIRECTION], {
      ignores: [...TEST_FILES, "src/lib/env.ts", "src/lib/env.client.ts"],
    }),
    maxLines(["src/**/*.{ts,tsx}"], { ignores: TEST_FILES }),
    globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
  ]),
);

export default eslintConfig;
