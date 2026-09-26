import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import schoolhub from "@schoolhub/config/eslint";
import warningsAsErrors from "@schoolhub/config/eslint-warnings-as-errors";
import {
  API_CLIENT,
  INLINE_QUERY_KEY,
  PARENT_RELATIVE,
  PHYSICAL_DIRECTION,
  PROCESS_ENV,
  REACT_COMPILER_ONLY_RULES_OFF,
  TEST_FILES,
  maxLines,
  restrictedImports,
  restrictedSyntax,
} from "@schoolhub/config/eslint-boundaries";

/** The transport layer — the only code that may import @schoolhub/api-client (ADR-0011). */
const TRANSPORT = ["src/services/**", "src/lib/**"];

// Existing violations of every rule below are frozen in ./eslint-suppressions.json (ADR-0014):
// that file may only shrink. Fix a violation and ESLint reports the suppression as unused
// until it is pruned; add one and CI fails.
const eslintConfig = warningsAsErrors(
  defineConfig([
    ...nextVitals,
    ...nextTs,
    ...schoolhub,
    REACT_COMPILER_ONLY_RULES_OFF,
    // One complete no-restricted-imports entry per file group — flat config replaces a rule's
    // options per file rather than merging them (see eslint.boundaries.mjs). Deny by default:
    // everything under src/ except the transport layer is barred from the API client.
    restrictedImports(["src/**"], [PARENT_RELATIVE, API_CLIENT], { ignores: TRANSPORT }),
    restrictedImports(TRANSPORT, [PARENT_RELATIVE]),
    {
      // Two legitimate exceptions to the import rules — everything else in src/ has a "@/"
      // alias to redirect to, but these don't:
      //  - __tests__/*.test.ts(x) siblings import their own module one level up
      //    ("../foo"), which is the established convention (see AGENTS.md); "@/" would
      //    also work here, but the shorter sibling form reads better for a test file.
      //    Tests may also import @schoolhub/api-client to build fixtures and mocks.
      //  - src/i18n/{request.ts,messages.types-check.ts} reach `messages/*.json`, which
      //    lives at the app root, outside src/ — "@/*" only maps to "./src/*", so there is
      //    no alias that reaches it.
      files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "src/i18n/**"],
      rules: { "no-restricted-imports": "off" },
    },
    restrictedSyntax(
      ["src/**/*.{ts,tsx}"],
      [PROCESS_ENV, INLINE_QUERY_KEY, ...PHYSICAL_DIRECTION],
      {
        ignores: [...TEST_FILES, "src/lib/env.ts"],
      },
    ),
    {
      // Every user-facing string goes through next-intl (messages/{en,ur}.json) — ADR-0014.
      files: ["src/**/*.tsx"],
      ignores: TEST_FILES,
      rules: {
        "react/jsx-no-literals": [
          "error",
          {
            noStrings: false,
            ignoreProps: true,
            allowedStrings: [
              "·",
              "•",
              "—",
              "–",
              "-",
              "/",
              "|",
              ":",
              "(",
              ")",
              "%",
              "+",
              "…",
              "×",
              "*",
              "#",
              "@",
              ",",
              ".",
            ],
          },
        ],
      },
    },
    maxLines(["src/**/*.{ts,tsx}"], { ignores: TEST_FILES }),
    globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
  ]),
);

export default eslintConfig;
