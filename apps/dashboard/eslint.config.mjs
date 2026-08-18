import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import schoolhub from "@schoolhub/config/eslint";

/**
 * `eslint-config-next/typescript` is deliberately NOT extended: it bundles its own
 * typescript-eslint, which resolves this app's TypeScript 7 and hard-throws
 * ("typescript-eslint does not support TS 7.0"). The TypeScript rules come from
 * `@schoolhub/config/eslint`, whose typescript-eslint resolves the TS 6 copy pinned in
 * `packages/config` — the side-by-side arrangement TypeScript 7 documents.
 * Revisit once typescript-eslint supports TS >= 7.1 (typescript-eslint#10940).
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...schoolhub,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
