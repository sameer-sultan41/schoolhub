import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads `e2e/.env` into `process.env`, if present.
 *
 * Side-effect module, imported before anything that reads config. Playwright does not read
 * `.env` on its own, and `src/env.ts` parses `process.env` at module load — so this has to
 * run first, which in ESM means being imported first.
 *
 * `process.loadEnvFile` is built into Node; the workspace already requires Node >= 24.
 */
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
