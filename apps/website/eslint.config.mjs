import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import schoolhub from "@schoolhub/config/eslint";
// Shared with apps/dashboard (byte-for-byte the same rules for both apps) — see
// packages/config/eslint.app.mjs for why this isn't in @schoolhub/config/eslint itself.
// Spread after nextVitals/nextTs: its jsx-a11y rules are listed by name against the
// plugin core-web-vitals registers first, not by importing eslint-plugin-jsx-a11y directly.
import schoolhubApp from "@schoolhub/config/eslint-app";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...schoolhub,
  ...schoolhubApp,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
