---
name: review-plan
description: Run an independent, adversarial review of a plan or spec before it is approved — phrases like "review this plan", "have another agent check my plan", "review the spec", "/review-plan docs/superpowers/plans/…". Forks into the read-only plan-reviewer agent, which checks goal fidelity, root cause, symptom suppression, reuse, SchoolHub ADRs and invariants, hardcoding, test lanes, docs and industry-standard alternatives, and returns a verdict plus a ready-to-paste `## Independent review` block. Required for superpowers specs/plans dated 2026-09-26 or later (CI checks for the block). SKIP for Tier 0/1 work and for reviewing a diff (dispatch the change-reviewer agent instead).
argument-hint: <path to a plan or spec file>
context: fork
agent: plan-reviewer
# Foreground: the next step needs the verdict, and a backgrounded fork gets a narrower
# tool set that can drop the reviewer's web and Context7 tools.
background: false
---

Review the plan or spec at: $ARGUMENTS

If no path was given, review the most recently modified file under `docs/superpowers/specs/`,
`docs/superpowers/plans/` or, for a plan-mode plan, `~/.claude/plans/` — and say which file you
chose. If the file links a spec or plan, read
that too.

Apply every check in your instructions, in order. Return the verdict, the findings table, the
divergence list, what you checked, and the ready-to-paste `## Independent review` block. Do not
edit the file — the author folds your findings in and appends the block.
