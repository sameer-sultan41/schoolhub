# Production preconditions

Run every row before `promote production` dispatches anything (SKILL.md, promote step 2).
Show one table: row, result (PASS / FAIL / ASKED / WARN), and the evidence line.
`$REPO` is `gh repo view --json nameWithOwner -q .nameWithOwner`; `<sha>` is the full SHA
being promoted; `git fetch origin main` has run.

| # | Check | Command | Pass rule | On FAIL |
|---|---|---|---|---|
| 1 | CI green on the SHA | `python3 .github/scripts/ci_gate.py --sha <sha> --wait-minutes 0` | exit 0 (`CI gate: …` green) | exit 1 = red or still running; exit 3 = superseded (a run was cancelled). Same script and exclusions as the workflow's `ci-gate`, so the two cannot disagree. Stop. |
| 2 | Staging ran it | `python3 .github/scripts/deployments.py ever-succeeded --env staging --sha <sha>` | exit 0 | exit 1: stop unless the user explicitly overrides; then dispatch with `allow_unstaged_sha=true` (Hard rule 4). Exit 2: cannot tell; stop. |
| 3 | Soak ≥ 24 h | start: `created_at` from `deployments.py show --env staging --sha <sha>`; end: the `created_at` of the next newer line in `deployments.py history --env staging`, or now | window ≥ 24 h, **and** the user confirms it covered a working day and a night (ASKED) | Stop unless the user overrides; record it in the approval comment. Times are the Deployment creation times, a few minutes before the success status. |
| 4 | Migration diff | `prod=$(python3 .github/scripts/deployments.py current --env production)`; `git diff --name-status ${prod:-$(git hash-object -t tree /dev/null)}..<sha> -- 'apps/api/**/migrations/*.py'`; for each added file `git show <sha>:<path>` | shown to the user (informational) | The authoritative check is the `preview` job's `check_migrations.py`, read at the approval gate. Do not run the checker locally (ADR-0007). With no production deploy yet, the diff runs from the empty tree; say so. |
| 5 | Dashboard launch blocker | `git show origin/main:docs/deferred-work.md \| grep -n 'launch-blocker:dashboard-runtime-env' \| grep -v '~~'` | nothing printed | **FAIL stops the mode** (Hard rule 7). Show the entry; dispatch nothing unless the user explicitly overrides in chat after reading it. State the override in the approval comment. |
| 6 | Other launch blockers | `git show origin/main:docs/deferred-work.md \| grep -n 'LAUNCH BLOCKER' \| grep -v '~~'` | nothing printed (ignore the lines row 5 already covers) | Show each entry and ask whether to continue (ASKED). |
| 7 | Image age | `git log -1 --format=%ct <sha>` | younger than 300 days | WARN: ECR expires SHA tags at 365 days; the rollout's `Verify all three images exist` fails on an expired tag (catalogue E5). |
| 8 | High-stakes window | ask: "Is any school in admissions, results publication or the first days of fee collection?" | the user answers | ASKED; a "yes" means the user decides whether to wait. |
| 9 | On-call aware | ask: "Is on-call aware of this deploy?" | the user answers | ASKED. |

Rows 1, 2, 5 must PASS (or carry the user's explicit override) before the dispatch. Rows 8
and 9 must be answered. Everything shown here also goes into the approval summary.
