/**
 * Import boundaries and banned syntax shared by the frontend workspaces (ADR-0011, ADR-0013's
 * frontend counterpart in repo-structure.md §3, ADR-0014).
 *
 * Flat config REPLACES a rule's options for a matching file rather than merging them, so every
 * `no-restricted-imports` / `no-restricted-syntax` entry must carry the complete list for its
 * files. Build them with `restrictedImports(files, patterns)` / `restrictedSyntax(files,
 * selectors)` from these constants rather than hand-writing overlapping entries.
 */

export const PARENT_RELATIVE = {
  group: ["../**"],
  message:
    'Use the "@/" alias instead of a parent-relative import ("../", "../../", etc.) — a same-directory "./foo" import is still fine.',
};

export const API_CLIENT = {
  group: ["@schoolhub/api-client", "@schoolhub/api-client/*"],
  message:
    "UI code calls the backend through `Services` and imports `ApiError` from \"@/services\" — only src/services/** and src/lib/** (the transport layer) import @schoolhub/api-client (ADR-0011).",
};

export const INTO_APPS = {
  group: ["**/apps/**"],
  message: "A shared package never imports application code (repo-structure.md §3).",
};

export const PLAYWRIGHT_DIRECT = {
  group: ["@playwright/test"],
  message: 'Specs import `test`/`expect` from "@/fixtures", which carries the suite\'s fixtures (e2e/AGENTS.md).',
};

export function restrictedImports(files, patterns, extra = {}) {
  return { files, ...extra, rules: { "no-restricted-imports": ["error", { patterns }] } };
}

export const PROCESS_ENV = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: "Read configuration through the app's typed env module (src/lib/env.ts, env.client.ts), not process.env (ADR-0014).",
};

export const INLINE_QUERY_KEY = {
  selector: "Property[key.name='queryKey'] > ArrayExpression",
  message: "Build query keys with the `queryKeys` factory in src/lib/query-client.ts, not inline arrays (ADR-0014).",
};

// Physical-direction Tailwind classes break the Urdu (RTL) layout; use ms-/me-, ps-/pe-,
// start-*/end-*, border-s/-e, rounded-s/-e, text-start/-end (ADR-0009). Centring with
// left-[50%] / left-1/2 is direction-neutral and allowed. Matched in className strings and in
// cn()/cva()/clsx() arguments, with or without a variant prefix (hover:, md:, !).
const PHYSICAL =
  "/(^|[\\s:!])(-?m[lr]-|-?p[lr]-|border-[lr](-|\\s|$)|rounded-[lr](-|\\s|$)|text-(left|right)(\\s|$)|-?(left|right)-(?!\\[50%\\]|1.2))/";
const PHYSICAL_MESSAGE =
  "Physical left/right Tailwind class — use the logical equivalent (ms-/me-, ps-/pe-, start-/end-, border-s/-e, rounded-s/-e, text-start/-end) so RTL works (ADR-0009).";
export const PHYSICAL_DIRECTION = [
  `JSXAttribute[name.name='className'] Literal[value=${PHYSICAL}]`,
  `JSXAttribute[name.name='className'] TemplateElement[value.raw=${PHYSICAL}]`,
  `CallExpression[callee.name=/^(cn|cva|clsx|twMerge)$/] Literal[value=${PHYSICAL}]`,
].map((selector) => ({ selector, message: PHYSICAL_MESSAGE }));

export function restrictedSyntax(files, selectors, extra = {}) {
  return { files, ...extra, rules: { "no-restricted-syntax": ["error", ...selectors] } };
}

/** Files shouldn't grow past 400 lines of code — split by responsibility instead. */
export function maxLines(files, extra = {}) {
  return {
    files,
    ...extra,
    rules: { "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }] },
  };
}

export const TEST_FILES = ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "**/jest.setup.ts", "**/test-utils.tsx"];
