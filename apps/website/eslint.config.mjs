import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import schoolhub from "@schoolhub/config/eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...schoolhub,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
