# Agent Lessons

> **Agent Context**
> **Summary:** Mistakes AI agents have already made in this repository, each with the check that prevents it. Read it before handing any change back, and add an entry whenever a reviewer, CI or the user catches a new one.
> **Co-load with:** [`testing-strategy.md`](testing-strategy.md) · [`tooling.md`](tooling.md) · [`../decisions/0007-ci-source-of-truth.md`](../decisions/0007-ci-source-of-truth.md)

## 1. How this file works

- **Before you hand work back,** run the checklist in §2. It is the part to read when short on time.
- **When a reviewer, CI or the user catches a mistake,** add a lesson in the same pull request as the fix (§4). A typo or a one-off slip is not a lesson; a mistake another agent could repeat is.
- **Reviewers cite lessons by id** (`L3`) in their findings, so a repeat is easy to spot and to count.
- **Prefer automation to prose.** When a check here can become a lint rule, a CI job or a test, build that and delete the lesson.

## 2. Before you hand work back

1. Every type imported from a barrel is exported by it (L1).
2. Generated files came from the generators, never from an editor (L2).
3. Every decision that rests on a premise has the premise checked end to end, including what the user can do after a failure (L3, L4).
4. Fixtures, mocks and comments say what the real server says and does (L5, L12).
5. Every wait and timeout is sized from the real path, using the existing named constant (L6).
6. You searched other specs and PRs for behaviour your change alters (L7).
7. Ids used as row or React keys are unique in the shape the API returns (L8).
8. Test inputs are the exact values the code branches on (L9).
9. A hook rejection was fixed at its cause, on the files it named (L10).
10. Every brief to a subagent carries this repository's overrides (L11).

## 3. Lessons

### L1. A type used across modules must be exported by its barrel

- **Mistake.** `promotion-decision-fields.tsx` imported `PromotionProposal` from `@/services`, but only the module's own `index.ts` exported it. Jest strips types, so no test failed; the typecheck job would have.
- **Check.** For each `import type { X } from "@/services"` you add or move, grep `X` in `apps/dashboard/src/services/index.ts`. Do this again after any late edit.

### L2. Never edit a generated file by hand

- **Mistake.** An implementer edited `apps/api/openapi.yaml` and `packages/api-client/src/schema.d.ts` to match a docstring change instead of running the generators. The result happened to match, but only a run proves it.
- **Check.** Run `apps/api/scripts/generate-openapi.sh` and `pnpm --filter @schoolhub/api-client generate`, then confirm `git status` shows no change you did not expect. Generators are not checks; running them is required (ADR-0005).

### L3. Do not defer a defect that an accepted decision depends on

- **Mistake.** The execute report showed a raw Python dictionary dump for a missing section, and it was deferred as a minor. The decision to make the section rule advisory relied on the report naming each failed student legibly. The whole-PR review reversed the deferral.
- **Check.** For each ruling or decision, write down the premise it rests on, and verify that premise on the real path before ruling a related defect minor.

### L4. Trace what the user can do after a failure

- **Mistake.** A student who failed execute for a missing section was treated as fixable later. In fact edits are draft-only, a partly executed batch cannot be rejected or reverted, and a new batch for the class is refused. Comments and docs said otherwise.
- **Check.** For any "advisory" or "fix it later" design, walk the recovery path in the code, state at each step what is allowed, and make the UI copy match. If there is no recovery, say so and record it in `docs/deferred-work.md`.

### L5. Fixtures and mocks must reproduce the server

- **Mistake.** Tests faked a failure message the server never sends ("No target section set."), so the screen the PR gate approved was not the screen users saw. A stateful mock that skipped the override-reason rule would have let "edit, then submit" pass where the real server refuses.
- **Check.** Copy messages, field names and status codes from the server source or its tests. A mocked-lane stub enforces the same rules as the endpoint it stands for. A stubbed API proves nothing about the server.

### L6. Size waits from the real path

- **Mistake.** The live journey waited for `Executed` with the default 5 s expect, though the UI polls every 2 s, the shortest path was already near 4 s, and the API lane allowed 30 s for the same job. A review note even suggested watching the first nightly run.
- **Check.** Add up the real path: request, poll interval, reload of the detail and worker start-up. Reuse the existing named constant (`LIVE_JOB_TIMEOUT_MS` in `e2e/src/lib/live-jobs.ts`) rather than a new number, and do not ship a wait you expect to flake.

### L7. A change can break a sibling PR's test

- **Mistake.** Adding Promotions to the Academics sidebar made the allocations spec ("a user with only the promotion view key sees no Academics group") false, in a PR that was already open.
- **Mistake (again, #119).** Registering `Services.periods`/`Services.rooms` broke `services/__tests__/index.test.ts`, which lists every domain; CI's coverage job caught it.
- **Check.** When you change shared navigation, permissions, barrels or fixtures, grep the specs and tests on sibling branches and open PRs for the behaviour, and fix them in the PR that causes the change. A new `Services` domain also updates the aggregate test that enumerates them.

### L8. Row ids must be unique in the data the API returns

- **Mistake.** The batch list used `batch_id` as its row id, but the endpoint groups by status, so a partly executed batch returns two rows with one `batch_id`: duplicate React keys.
- **Check.** Before using a field as a row id or key, read how the queryset is grouped or joined. If one entity can appear twice, key on the entity plus whatever splits it.

### L9. Test inputs must be the values the code branches on

- **Mistake.** Several PR tests failed in CI for input reasons: a plain `Error` stood in for a refused job poll the code now tells apart from an `ApiError`; an on-commit callback was never run; a click landed before the component that owns the control had mounted; an aggregate test did not list the new module.
- **Check.** For each branch under test, build the exact input that takes it (the right error class, the callback, the awaited element). When you add a module or section, update every test that enumerates them.

### L10. Fix a hook rejection at its cause, on the files it names

- **Mistake.** Hand-formatted code failed Prettier on several files; an old `noqa` was reported unused by ruff; cspell rejected two coined words in a comment and a doc.
- **Check.** Apply the fix the hook prints, on exactly the files it lists. Delete an unused `noqa` rather than re-adding it, reword a flagged word rather than growing `.cspell/project-words.txt`, and never use `--no-verify`. Keep the reason a removed `noqa` carried as a plain comment.

### L11. Briefs to subagents must carry this repository's overrides

- **Mistake.** Skill defaults tell implementers to commit and to run tests, which contradicts ADR-0007 and the rule to commit only on the user's go-ahead. A read-only reviewer was also told to write its report file and could not, so its findings reached the user only in its reply.
- **Check.** Every dispatch says: never commit or push, never run tests, lint or typecheck, stage only your own files by explicit path, no `.env`, no AI attribution, write the report early. A read-only agent returns its findings in the reply instead of writing a file.

### L12. Keep comments and docs true to the change

- **Mistake.** A docstring still said examinations and attendance do not exist after they shipped, and a comment said a row "can be fixed later" when it could not.
  The timetable setup screens shipped delete copy ("a period in use cannot be removed") for a refusal the server never made: a soft delete never meets `on_delete=PROTECT` (#119, caught in change review).
- **Check.** After a change, grep the nearby comments, docstrings and docs for the claim it makes false, and fix them in the same commit.

### L13. Check the machine before heavy work

- **Mistake.** A full disk made shell calls fail mid-review, and the commit hooks write to disk too. A machine that sleeps also kills background agents.
- **Check.** Run `df -h` before a long review wave or a commit. Have long-running agents write their report file early and keep it current.

## 4. Adding a lesson

1. Number it next (`L14`) and give it a short title that states the rule.
2. Write **Mistake** (what happened, with the file, commit or PR) and **Check** (what to do, concrete enough to run). Two to four lines each.
3. Add it to the §2 checklist if it applies to every hand-back.
4. If it overlaps an existing lesson, extend that one instead.
5. If a lint rule, CI job or test now catches it, delete the lesson and link the check from [`tooling.md`](tooling.md) instead.
