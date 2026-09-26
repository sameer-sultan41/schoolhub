import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import base from "@schoolhub/config/eslint";
import warningsAsErrors from "@schoolhub/config/eslint-warnings-as-errors";
import {
  INTO_APPS,
  PROCESS_ENV,
  TEST_FILES,
  maxLines,
  restrictedImports,
  restrictedSyntax,
} from "@schoolhub/config/eslint-boundaries";

export default warningsAsErrors(
  defineConfig([
    ...base,
    // This package's tsconfig include is scoped to src/**/*.ts only (see tsconfig.json).
    // Without this, a future root-level .ts file (a jest.config.ts, a small codegen
    // script) would hard-error under type-aware linting — "file not found by the project
    // service" — rather than degrading to a normal rule result the way disableTypeChecked
    // already handles for the shared *.mjs configs.
    { files: ["*.ts"], ...tseslint.configs.disableTypeChecked },
    restrictedImports(["src/**"], [INTO_APPS]),
    restrictedSyntax(["src/**/*.ts"], [PROCESS_ENV], { ignores: TEST_FILES }),
    // Generated declaration files (the OpenAPI schema.d.ts) are exempt from the size cap.
    maxLines(["src/**/*.ts"], { ignores: [...TEST_FILES, "**/*.d.ts"] }),
  ]),
);
