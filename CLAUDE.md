## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

**Note:** `graphify-out/` is gitignored — it is a local, regenerable index, not
committed source. A fresh clone has no graph until someone runs `/graphify` (or
`graphify update .` for a code-only refresh) in it; these rules are inert until then.

## Skills

Project skills live in `.claude/skills/<name>/SKILL.md` — see `.claude/skills/schoolhub-testing/`
and `.claude/skills/schoolhub-api-services/` for the format (YAML frontmatter with `name` and
a trigger-phrase `description`, then the actual how-to with real paths and real code).

- When a task in this repo is genuinely repeated — the same kind of change gets made the
  same way more than once, or a convention exists that a future session would otherwise
  have to rediscover from scratch by reading a PR or a chat transcript — write it up as a
  skill instead of leaving it as tribal knowledge.
- A skill earns its place by being reusable, not by being interesting: a one-off
  investigation, a single-PR migration, or anything already fully captured in a module's
  own `AGENTS.md` doesn't need a separate skill.
- Keep it concrete — real file paths, real code from this repo, a checklist — matching
  `schoolhub-testing`'s or `schoolhub-api-services`'s level of detail, not generic advice.

## Colors: theme tokens only, never arbitrary-value literals

Never write a raw Tailwind arbitrary-value color utility in component code —
`text-[oklch(0.55_0.18_342)]`, `bg-[#3b82f6]`, `border-[rgb(0,0,0,0.1)]`, or any
`var(--color-x-accent, var(--color-y-500))` fallback-only reference that never
resolves to a real definition. These are invisible to the design system: they
don't adapt to dark mode, can't be tenant-branded, and don't show up when
someone greps for the palette.

Every color used anywhere in the app must be a real token, defined once in
`packages/ui/src/styles/theme.css`:

1. Add `--sh-color-<name>` (and `-foreground` if it's ever used as a fill) in
   the light-mode `:root` block, with a dark-mode redefinition in both dark
   blocks (`@media (prefers-color-scheme: dark)` and the explicit
   `:root[data-theme="dark"]`/equivalent toggle block) if the light-mode value
   doesn't already clear contrast on a dark surface.
2. Alias it in the `@theme inline` block: `--color-<name>: var(--sh-color-<name>)`.
3. Use it via the normal Tailwind utility the alias generates — `bg-<name>`,
   `text-<name>-foreground` — never the bracket/arbitrary-value form.

`--sh-color-rose`/`--color-rose` (`theme.css`, used by `badge.tsx`'s `rose`
variant) is a worked example: a hand-picked hue for a status with no existing
semantic color, defined once with light/dark values and a documented reason
for the exact hue chosen, then referenced everywhere as `bg-rose`/
`text-rose-foreground`/`text-rose` — never as an inline `oklch(...)` literal.
