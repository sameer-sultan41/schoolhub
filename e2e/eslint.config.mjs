import { defineConfig, globalIgnores } from "eslint/config";
import schoolhub from "@schoolhub/config/eslint";

export default defineConfig([
  ...schoolhub,
  globalIgnores(["playwright-report/**", "test-results/**", ".auth/**"]),
]);
