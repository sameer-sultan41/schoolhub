import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import schoolhub from "@schoolhub/config/eslint";
import noRelativeParentImports from "@schoolhub/config/eslint-no-relative-parent-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...schoolhub,
  ...noRelativeParentImports,
  {
    // Two legitimate exceptions to "no ../" — everything else in src/ has a "@/" alias
    // to redirect to, but these don't:
    //  - __tests__/*.test.ts(x) siblings import their own module one level up
    //    ("../foo"), which is the established convention (see AGENTS.md); "@/" would
    //    also work here, but the shorter sibling form reads better for a test file.
    //  - src/i18n/{request.ts,messages.types-check.ts} reach `messages/*.json`, which
    //    lives at the app root, outside src/ — "@/*" only maps to "./src/*", so there is
    //    no alias that reaches it.
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "src/i18n/**"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
