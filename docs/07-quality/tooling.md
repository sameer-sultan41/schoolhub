# Repository Tooling — Hooks, Formatting, Spelling, Blame

> **Agent Context**
> **Summary:** How the local git hooks, Prettier, cspell and `git blame` are wired in this repo, and why each sits where it does. Moved out of the root `AGENTS.md` so that file stays short. The decision behind the hook split, and CI as the authority, is [ADR-0007](../decisions/0007-ci-source-of-truth.md). Read this when a hook rejects a commit, when touching formatter/spelling config, or when setting up a clone.
> **Co-load with:** [`../decisions/0007-ci-source-of-truth.md`](../decisions/0007-ci-source-of-truth.md) · [`testing-strategy.md`](testing-strategy.md)

CI is the authority on pass/fail. Everything here exists to catch, sooner and more
cheaply, what CI would reject anyway.

## Setup per clone — automatic

`pnpm install` runs the root `package.json` `prepare` script, which does both of these (and is a
no-op where there is no `.git`, such as the Docker builds):

```bash
git config core.hooksPath .githooks
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Until `core.hooksPath` is set, none of the hooks below execute — the cheap errors they catch
then cost a CI round trip each instead. Check with `git config core.hooksPath` (expect
`.githooks`).

## Git hooks

| Hook | Runs | Checks |
| ---- | ---- | ------ |
| `pre-commit` | staged files only, fast | ESLint · Prettier (`--check`) · ruff (`check` + `format --check`) · cspell · gitleaks |
| `commit-msg` | the message | Conventional Commit subject · no AI attribution · `Root cause:` on `fix` commits ([ADR-0016](../decisions/0016-commit-message-rules.md)) |
| `pre-push` | project-wide, slower | `main`-push block · `tsc` typecheck · mypy · graphify index refresh |

Split by cost: `tsc` and mypy need the whole project graph and are too slow to run on every
commit. A tool that is genuinely not installed (`apps/api`'s uv-managed `.venv` never having
been synced, say) **warns and skips** rather than blocking — CI remains the authority, and a
frontend-only contributor must still be able to commit.

ESLint is type-aware (`strictTypeChecked` + `projectService`) and stays in `pre-commit`
deliberately — measured, not assumed: ~8s for a full 7-workspace `pnpm lint` cold, under 1s
warm (turbo cache), ~11s for a realistic multi-workspace staged commit. Nowhere near slow
enough to justify deferring it to `pre-push`, and it is the check most likely to catch a real
bug (`no-floating-promises`, `no-misused-promises`) before it is even committed.

The graphify refresh is a pure convenience, never a gate — it never fails the push even if it
errors. `graphify-out/` is gitignored (a local, regenerable index, not committed source), so
this only ever keeps the current machine's copy current, never a teammate's clone or CI's
checkout; each of those needs its own `/graphify` run. ~2s on this repo's current size
(AST-only, no LLM/API cost).

`SKIP_HOOKS=1` skips the lint, typecheck, secret-scan and commit-message checks for one commit
or push. **It does not bypass
the `main`-push block** — that check runs before `SKIP_HOOKS` is even read, deliberately, since
it enforces the PR-only workflow, not code quality. `git push --no-verify` is the only way past
it. Both escape hatches are for humans in an emergency; agents never use them.

## Lint baselines — `eslint-suppressions.json`

Every workspace lints with `--max-warnings 0`, and every rule a config sets to `warn` is raised
to `error` (`packages/config/eslint.warnings-as-errors.mjs`). Violations that existed when a rule
was introduced are frozen in the workspace's `eslint-suppressions.json` (ESLint's bulk
suppressions, [ADR-0014](../decisions/0014-no-hardcoded-values.md)):

- **New code can't add a violation** — anything not in the baseline fails `pnpm lint`.
- **Fixed violations must be pruned** — ESLint exits 2 when a suppression no longer matches.
- **The baseline can only shrink** — the `lint-baselines` job in `repo-hygiene.yml` fails if
  any file/rule count goes up (a renamed file carries its entries).

Baselines are generated in CI, never locally (ADR-0007): add the `generate-baselines` label to
the PR (remove and re-add it to run again), or run the `generate-baselines` workflow once it is on
`main`. It prunes stale suppressions, re-suppresses what remains and runs Prettier, then uploads
one patch: `gh run download <run-id> -n ci-generated` and `git apply ci-generated.patch`. The
baselines are excluded from Prettier and cspell — ESLint owns their format.

## Spelling — cspell

Configured in `cspell.json`; run with root `pnpm spell`; enforced in CI by `repo-hygiene.yml`.
Project vocabulary lives in `.cspell/project-words.txt` — add a genuine term there; do not add a
word to silence a real typo. The docs are written in British English, which the `en-GB` locale
covers, so those spellings are not listed individually.

## Formatting — Prettier

Root `prettier.config.mjs`; `apps/dashboard`, `apps/website` and `packages/ui` each extend it
with `prettier-plugin-tailwindcss`, since Tailwind v4 is CSS-first and there is no single shared
stylesheet to point the sorter at — `packages/ui`'s own `styles/theme.css` is a partial, so it
points at `apps/dashboard`'s full stylesheet instead, which resolves the same theme.

`pnpm format` writes, `pnpm format:check` verifies (both run `prettier .`, letting
`.prettierignore` be the one place that decides what Prettier owns) — the same check CI runs in
`repo-hygiene.yml`. `.prettierignore` deliberately excludes:

- markdown (hand-tuned tables and mermaid diagrams);
- `apps/api/**` and `infra/**` (their own tooling — ruff, Terraform — not Prettier's);
- `packages/api-client/src/schema.d.ts` (generated; reformatting it would break the
  schema-staleness gate in `frontend.yml`).

`eslint-config-prettier` is wired into the shared ESLint base last, per Next.js's own documented
integration, so ESLint's formatting-adjacent rules never fight Prettier's.

## `git blame` and `.git-blame-ignore-revs`

The first repo-wide Prettier pass is listed in `.git-blame-ignore-revs`, so `git blame` skips
over it and still points at the commit that actually changed a line's meaning. Add a commit's
SHA there only when it is genuinely mechanical (a formatter run, a mass rename) and nothing
else. The file only works because PRs land as merge commits — a squash merge produces a new SHA
the file never listed ([ADR-0006](../decisions/0006-merge-commits.md)).
