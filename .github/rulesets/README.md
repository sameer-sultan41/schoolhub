# Branch rulesets

`main.json` is the branch protection this repository is meant to run with, kept in version
control so it is reviewable and reproducible rather than clicked into a settings page once.

## What it enforces on `main`

| Rule | Effect |
| ---- | ------ |
| `pull_request` | No direct pushes — every change lands through a PR. Stale reviews are dismissed on a new push, and review threads must be resolved before merge. `0` required approvals so a solo maintainer is not deadlocked (GitHub does not allow self-approval); raise this to `1` as soon as there are two people. |
| `required_status_checks` (strict) | The always-running `repo-hygiene` checks must pass — workflow YAML, markdown links, cspell, Prettier, project-status sync, secret scan, the plan-review gate tests and record check, and commit messages — **and** the branch must be up to date with `main`. The path-filtered `api`/`frontend` jobs are deliberately **not** required: a PR that doesn't touch their paths never runs them, and a required check that never runs blocks the merge forever. |
| `allowed_merge_methods: [merge]` | Merge commits only ([ADR-0006](../../docs/decisions/0006-merge-commits.md)) — `.git-blame-ignore-revs` depends on the SHAs surviving. |
| `non_fast_forward`, `deletion` | `main` cannot be force-pushed or deleted. |

## Applying it

**Not applied — and superseded in practice.** The repository is now public, and `main` is
protected by **classic branch protection** instead (PR required, the six `repo-hygiene` checks
required and strict, admins included, no force-push or deletion, linear history off — see
`docs/project-status.md` "Repository settings"). This ruleset has been corrected to match
[ADR-0006](../../docs/decisions/0006-merge-commits.md) (merge commits only) and to require every
always-running `repo-hygiene` check, so applying it would tighten, not loosen, protection.
(While the repository was private, both the `branches/main/protection` and `rulesets` APIs
returned `403 Upgrade to GitHub Pro or make this repository public`; that no longer applies.)

Rulesets are available now; this one is unapplied by choice, because classic protection
already covers the essentials. To apply it — or to add the newer checks to classic protection
instead — use either:

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json
```

or **Settings → Rules → Rulesets → New ruleset → Import a ruleset** and upload this file.

Verify afterwards:

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | "\(.name) — \(.enforcement)"'
```

## What is enforced in the meantime

Classic branch protection on `main` (see above) requires a PR and the six original
`repo-hygiene` checks. Repository merge settings allow merge, squash and rebase; PRs land as
merge commits by convention (ADR-0006). Head branches are **not** auto-deleted on merge. The
path-filtered `api`/`frontend` checks are visible on every PR that triggers them but are not
blocking — "green before merge" for those is still discipline.
