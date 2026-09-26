# 0015. Non-trivial plans pass an independent reviewer before approval

- **Status:** Accepted
- **Date:** 2026-09-26
- **Enforced by:** `.claude/hooks/plan_review_gate.py` (PreToolUse on `ExitPlanMode`, registered in `.claude/settings.json`, tested by the `plan-review-gate` job in `repo-hygiene.yml`), and `.claude/hooks/check_review_records.py` (the `plan-review-record` job, same rule via the gate's `decide()`) for spec/plan files dated 2026-09-26 or later. Both CI jobs are advisory until they are added to `main`'s required status checks.

## Context

In the last 200 commits before this record, `fix` commits outnumbered `feat` about two to one
(81 vs 39). There were runs of 4–7 same-scope fixes, and `diag:` commits landed on shared
branches. The pattern is plans that treat a symptom, drift from their goal, or skip the
established solution, and nobody catches it before code is written. The organisation's generic
reviewer agents (`lu-*`, `g-flow`) encode another codebase's rules (`app_id` scoping, US
spelling), so they flag the wrong things here.

## Decision

Every task is classified work tier 0, 1 or 2 (root `AGENTS.md` "Working Method"), stated in a
plan as a `**Work tier:** n` line. The marker says "Work tier" because "Tier 0 — Foundation" and
similar already name module build order in this repo; a build-order heading must never read as
a review exemption. A Tier 2 plan is
reviewed by this repo's own read-only `plan-reviewer` agent before the user is asked to approve
it. The reviewer checks goal fidelity, root-cause evidence, symptom suppressors, reuse, the ADRs,
the invariants, hardcoding, test lanes, docs, and industry-standard alternatives with sources.
Its verdict is recorded in the plan as an `## Independent review` block. After implementation,
the `change-reviewer` agent checks the diff against that plan, including a required divergence
section.

The gate is a deterministic `command` hook that reads the plan text the hook payload carries
(`tool_input.plan`, confirmed from a captured payload). It allows work tier 0/1, an explicit
`**Review:** waived by user`, or a review block with an APPROVE or REVISE verdict. It denies an
unreviewed plan or a RETHINK verdict, and fails open on any error. A verdict counts only at the
start of a line (`Verdict: APPROVE`, `- **Verdict:** **REVISE**`, `### Verdict: RETHINK`), so a
phrase in a later finding's prose can't override it.

### What the gate cannot prove

The review block is text in the plan, and the agent that wrote the plan can type text. Presence
of a block is not proof a reviewer produced it. The session gate narrows this: when a plan is
allowed *only* because of a review block, it reads the session transcript the hook payload
names (`transcript_path`) and denies unless that transcript records a `plan-reviewer` Agent
dispatch, a `review-plan` Skill call, or the user typing `/review-plan`. Records are judged by
their structure (an assistant `tool_use`, a user command record), not by searching the text, so
the same words quoted in prose, a tool result or a file the session read don't count. A review
run in another session, before `/clear`, or by a subagent isn't in this transcript either; the
denial says to re-run it here or ask the user to waive. That is a binding to
"a review ran in this session", not to "this block is that review's output" — an agent could
still run the reviewer and then paste a different verdict. If the transcript is missing or
unreadable the gate fails open, as it does for every other error.

CI's `plan-review-record` job has no transcript, so for spec and plan files it checks presence
only. What closes the remaining gap is the human step this record already requires: the user
reads the verdict and findings before approving, and the `change-reviewer` later checks the diff
against the plan. A cryptographic attestation (a signed reviewer output) was considered and
rejected: nothing in a local agent session can hold a key the planning agent can't also read.

## Alternatives considered

- **An `agent`-type hook that runs the review itself** — why not: documented as experimental. It
  would also run a full model review on every `ExitPlanMode`, even for a re-submission, with
  non-deterministic output. The command hook is cheap and predictable, and the review runs once,
  where the session can see and act on it.
- **On-demand review only (`/review-plan`)** — why not: it helps only when someone remembers,
  which is the failure mode this record exists to fix.
- **Review every plan, whatever its size** — why not: it costs a model run on typo fixes, and
  people learn to route around gates that waste their time.
- **Reuse the organisation's `lu-*` reviewers** — why not: they enforce rules that are wrong
  for this repo. Changing the shared sourcebook to suit one repo was rejected.

## Consequences

Every plan must state its work tier; a plan that states none is treated as work tier 2. Self-declared Tier 0/1 and the waiver are visible in the plan the
user approves, so they can't be abused silently. The gate can't judge review *quality*, only
presence in CI, plus a reviewer run in the session when its transcript is readable; the user
still reads the verdict. Plans from the superpowers flow never pass through
`ExitPlanMode`, so CI checks their files instead, with older files grandfathered by date.
