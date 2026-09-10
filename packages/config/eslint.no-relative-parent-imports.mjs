/**
 * Forbids "../" (and "../../", etc.) imports in favor of the "@/" alias.
 *
 * Opt-in — spread into a workspace's own `eslint.config.mjs`, after `@schoolhub/config/eslint`
 * — rather than part of the shared base, because only a workspace with a `"@/*": ["./src/*"]`
 * `tsconfig.json` path has an alias to redirect to; `packages/*` don't and would just break.
 *
 * Exists because a wrong "../" depth is a silent, easy mistake — TypeScript and ESLint's
 * default rules don't catch a path that resolves to a different (or nonexistent, if caught
 * by a bundler error) file than intended, and it's tedious to count by eye once a file sits
 * more than two or three directories deep. `@/foo` always resolves from `src/` regardless
 * of where the importing file lives, so there's nothing to miscount.
 *
 * A same-directory `./foo` import is unaffected — only a parent-crossing `../` is forbidden.
 */
export default [
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message:
                'Use the "@/" alias instead of a parent-relative import ("../", "../../", etc.) — a same-directory "./foo" import is still fine.',
            },
          ],
        },
      ],
    },
  },
];
