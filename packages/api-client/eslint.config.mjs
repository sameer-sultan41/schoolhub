import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import base from "@schoolhub/config/eslint";

export default defineConfig([
  ...base,
  // This package's tsconfig include is scoped to src/**/*.ts only (see tsconfig.json).
  // Without this, a future root-level .ts file (a jest.config.ts, a small codegen
  // script) would hard-error under type-aware linting — "file not found by the project
  // service" — rather than degrading to a normal rule result the way disableTypeChecked
  // already handles for the shared *.mjs configs.
  { files: ["*.ts"], ...tseslint.configs.disableTypeChecked },
]);
