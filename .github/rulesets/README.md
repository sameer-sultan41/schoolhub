# Branch rulesets

`main.json` is the branch protection this repository is meant to run with, kept in version
control so it is reviewable and reproducible rather than clicked into a settings page once.

## What it enforces on `main`

| Rule | Effect |
| ---- | ------ |
| `pull_request` | No direct pushes — every change lands through a PR. Stale reviews are dismissed on a new push, and review threads must be resolved before merge. `0` required approvals so a solo maintainer is not deadlocked (GitHub does not allow self-approval); raise this to `1` as soon as there are two people. |
| `required_status_checks` (strict) | `Lint · Typecheck · Test`, `Build (dashboard)`, `Build (website)`, and `Secret scan` must pass, **and** the branch must be up to date with `main` before merging. |
| `required_linear_history` | No merge commits — squash or rebase only. |
| `non_fast_forward`, `deletion` | `main` cannot be force-pushed or deleted. |

## Applying it

**Not currently active.** Branch protection and rulesets are gated behind GitHub Pro (or an
organisation plan) for **private** repositories; both the
`branches/main/protection` and `rulesets` APIs return:

```
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

Once the account is on Pro/Team, apply it with either:

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json
```

or **Settings → Rules → Rulesets → New ruleset → Import a ruleset** and upload this file.

Verify afterwards:

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | "\(.name) — \(.enforcement)"'
```

## What is enforced in the meantime

Repository-level merge settings are not plan-gated, and they are already set to match the
intent above:

- merge commits **disabled**, squash and rebase allowed → linear history by construction
- head branches **auto-deleted** on merge

CI still runs on every pull request, so a red PR is always visible — it just is not *blocking*
until the ruleset is active. Until then, "green before merge" is a discipline, not a guarantee.
