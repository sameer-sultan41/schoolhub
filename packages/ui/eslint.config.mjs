import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import base from "@schoolhub/config/eslint";
// Just the tokens-only-colour and RTL-safety no-restricted-syntax rules, not the whole
// eslint-app export: "no hardcoded palette colour"/"no physical-direction utility" applies
// to this package's own component source exactly as much as to app code, but
// react/forbid-elements (also in that export) does not — this package has to render the
// raw <button>/<input>/etc. it wraps in order to build the components apps/* are forbidden
// from rendering those elements in.
import { tokensOnlyRules } from "@schoolhub/config/eslint-app";

/**
 * `packages/ui` is a framework-agnostic React component library, not a Next.js app, so
 * it pulls `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` directly rather than
 * through `eslint-config-next` (which bundles Next-specific rules that don't apply here
 * and are already active in every app that consumes this package).
 *
 * Previously this workspace had neither plugin at all despite shipping 5 `.tsx`
 * components — no rules-of-hooks enforcement, no accessibility linting, despite the
 * repo's own WCAG 2.1 AA requirement (root AGENTS.md).
 */
export default defineConfig([
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  ...base,
  tokensOnlyRules,
  // This package's tsconfig include is scoped to src/**/*.ts(x) only (see tsconfig.json).
  // The shared base's disableTypeChecked block already covers jest.setup.ts by exact
  // name — this covers any OTHER future root-level .ts file (a codegen script, say),
  // which would otherwise hard-error under type-aware linting rather than degrade to a
  // normal rule result.
  { files: ["*.ts"], ...tseslint.configs.disableTypeChecked },
]);
