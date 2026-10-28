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
8. Test inputs are the exact values the code branches on, and an unrelated edit still passes (L9, L18).
9. A hook rejection was fixed at its cause, after reading its error, on the files it named (L10).
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
- **Mistake (again, attendance dashboard PR C).** Import was put on the Records toolbar, and Records was gated on `attendance.student-attendance.view`. §4 grants the import key to `it_admin` alone, and `it_admin` does not hold `.view`, so the only role meant to import could not reach the button. The premise "an importer can open Records" was never checked against `permissions.py`.
- **Check.** For each ruling or decision, write down the premise it rests on, and verify that premise on the real path before ruling a related defect minor. When an action lives on a screen, check that every role §4 grants the action can open that screen.

### L4. Trace what the user can do after a failure

- **Mistake.** A student who failed execute for a missing section was treated as fixable later. In fact edits are draft-only, a partly executed batch cannot be rejected or reverted, and a new batch for the class is refused. Comments and docs said otherwise.
- **Check.** For any "advisory" or "fix it later" design, walk the recovery path in the code, state at each step what is allowed, and make the UI copy match. If there is no recovery, say so and record it in `docs/deferred-work.md`.

### L5. Fixtures and mocks must reproduce the server

- **Mistake.** Tests faked a failure message the server never sends ("No target section set."), so the screen the PR gate approved was not the screen users saw. A stateful mock that skipped the override-reason rule would have let "edit, then submit" pass where the real server refuses.
- **Mistake (again, attendance dashboard PR A).** The register's on-leave test paired the generic banner "Some rows could not be marked; the register was not saved." with the on-leave issue, but the server sends that issue only in a later, separate refusal with its own sentence ("Some students are on approved leave; the register was not saved."). Other fixtures mixed a not-enrolled row and an on-leave row in one error, which the server cannot send. Each sentence was real; the pairing was not.
- **Mistake (again, attendance dashboard PR C).** The attendance import job returned `{rows, succeeded, errors}` while the shared import dialog reads every importer's `{total, succeeded, failed, errors}`, so its "N failed" badge never showed. No fixture carried the attendance job's result, so nothing compared the consumer's shape with the producer's; the e2e stub written from `tasks.py` exposed it.
- **Mistake (again, attendance dashboard PR C).** The e2e `it_admin` fixture (`ATTENDANCE_IMPORT_PERMISSIONS`) also granted `.view`, which the real role lacks, so the mocked import spec passed on a screen the real `it_admin` could not open.
- **Check.** Copy messages, field names and status codes from the server source or its tests. A fixture named for a role holds that role's keys from the module's `permissions.py`, no more. A mocked-lane stub enforces the same rules as the endpoint it stands for. A refusal fixture pairs each issue with the sentence the server sends for that kind of issue, in the order the server checks them, and never combines issues one response cannot carry. A stubbed API proves nothing about the server.

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
- **Mistake (again, attendance PR A).** `eslint --fix` dropped a type assertion it called unnecessary on a test fixture, which widened `subject_type`/`status` to `string`; the pre-push typecheck failed. The fixture needed a return type, not the assertion.
- **Check.** Apply the fix the hook prints, on exactly the files it lists. Delete an unused `noqa` rather than re-adding it, reword a flagged word rather than growing `.cspell/project-words.txt`, and never use `--no-verify`. Keep the reason a removed `noqa` carried as a plain comment. When a hook prints no detail (the pre-push mypy check), run the command it names once and read the error before editing; two guessed fixes in a row failed before the real cause (a class variable overridden by an annotated attribute) was read.

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

### L14. A drag handle is not the thing being dropped

- **Mistake.** The timetable grid's keyboard drag measured collisions with `closestCenter` from a small drag handle in a cell's corner, so the "nearest cell" was often the neighbour or the source itself; the mocked E2E keyboard moves made no request (#120). Unit tests passed because they fed cell-sized boxes, not the handle-sized one dnd-kit actually measures.
- **Check.** When the draggable node is a handle, decide collisions by what contains it (`pointerWithin` for a pointer, `rectIntersection` for keyboard), never by nearest centre, and give the pure helpers the handle-sized box the sensor really reports.
- **Mistake (again, three times).** The keyboard E2E kept failing because two causes overlapped, and each fix chased one.
  - **Layout.** The trace's live-region text showed one ArrowRight announcing "Over Wednesday". `keyboardStep` kept the handle's pixel offset from its cell's edge, and a filled Monday column is wider than an empty Tuesday. The Jest cases used equal-width cells.
  - **Timing.** dnd-kit's `KeyboardSensor.attach()` renders the drag (`aria-pressed`) and only then adds its keydown listener in a `setTimeout`. Chrome runs a queued key before a timer, so waiting for `aria-pressed` didn't help. A throwaway draft PR with logging passed outright, which showed the slowdown alone was enough; the sensor's source confirmed it.
- **Check.**
  - Read the failing run's trace before writing any second fix, including what the page *said* (live regions, error text in the snapshots).
  - Give layout helpers unequal boxes in their unit tests.
  - Read a library's source before deciding what a DOM signal proves. In a browser spec, put an ordering barrier (a `setTimeout(0)` of your own) behind a timer the library schedules, rather than a sleep (`WeekGridPage.keyboardMove`).

### L15. A new rule breaks the specs that relied on the old one

- **Mistake.** Timetable PR C opened "My timetable" to `timetable.timetable.view`, but PR A's spec still asserted a view-only user sees no Timetable group. It also made cover campus-bound, while the live cover journey's substitute sat on the seeded campus and its grid on a fresh one. Both would have failed CI or the nightly run, and the change review caught them, not the author.
- **Check.** When a change widens or narrows who sees something, or what a rule accepts, grep the specs and live fixtures for the old behaviour: assertions of absence (`toHaveCount(0)`), fixtures built for the rule (campus, session dates, seeded staff), and wall-clock dates against fixed fixture windows. Fix them in the same PR.

### L17. A Dockerfile change breaks the compose targets that name it; a never-green workflow hides every later step

- **Mistake.** `f7511d7` created the frontend `Dockerfile`s with `deps`/`builder`/`runner`, while compose kept building `target: dev`; the API `Dockerfile`'s own comment records the same break once before. `e2e-live` then failed all 50 recorded runs, and its first fix (MinIO, ADR-0025) only uncovered the next break: no PgBouncer userlist, migrations as the app role, env names the apps don't read, and then a `0600` userlist that a Linux bind mount hides from PgBouncer's uid 70 (macOS's Docker Desktop never showed it). The first plan said "no other change needed for CI", from a workflow that had never got past building images.
- **Check.** When a `Dockerfile`'s stages or build args change, check every compose `target:` and `args:` that names them (`infra-compose`'s `images` job now builds them all). Before claiming a never-green workflow needs only one fix, read every step after the first failure as untested.

### L18. A check added to an update path must name the transitions it guards

- **Mistake.** A re-check of the teacher and curriculum was meant for Reinstate and promote-to-primary, but it was written as `effective_to is None`, which is true for every PATCH on an active row. Editing `weekly_periods` then failed whenever the teacher had gone inactive elsewhere.
- **Check.** State the exact transitions the rule covers, build the condition from the before and after values, and add the negative test: an unrelated edit on the same row still succeeds.

### L19. Quote a heredoc that contains backticks or dollar signs

- **Mistake.** An unquoted `<<EOF` that wrote a docstring had the words it put in backticks run as shell commands, so the file was written with the words missing.
- **Check.** Use `<<'EOF'` (or write the file with an editor tool) for any text with backticks, `$` or backslashes, and read the result back before committing.

### L20. When you send the server "today", send the server's today

- **Mistake.** A seed script ended an allocation with the local date. The server counts days in UTC, which was one day behind, so the date looked like the future and the call failed.
- **Check.** Take dates for "today" from the server's clock (UTC) or the response's `Date` header, never from the machine's local date, and note it in the test.

### L21. Another session may be using the same checkout

- **Mistake.** The branch and HEAD changed between my commands because a second session worked in the same repository, so a branch I thought was checked out was not.
- **Mistake (again, attendance dashboard).** A worktree's linked `node_modules` resolved workspace packages such as `@schoolhub/api-client` into the *main* checkout, so the worktree's pre-push typecheck checked one branch's code against another branch's generated types.
- **Check.** Run `git branch --show-current` and `git status` before every git write. Do parallel work in a separate `git worktree`, but commit there only if the hooks can run: Prettier's Tailwind plugin and mypy failed in a worktree with a linked `node_modules`, so hook-sensitive commits belong in the main checkout. If you do push from a worktree, first point each workspace package whose generated output differs (`@schoolhub/api-client`) at the worktree's own copy, and check where its `node_modules` link resolves.

### L22. Compiling a queryset to SQL raises where iterating it returned nothing

- **Mistake.** Attendance's derived-day reports wrap the scoped queryset's own SQL in a CTE (`queryset.query.sql_with_params()`, later `get_compiler(...).as_sql()`). For `.none()` — what `scope_queryset` returns to fail closed — or an empty `__in` (an exam whose results are all withheld), Django raises `EmptyResultSet` at compile time, where iterating the same queryset had returned `[]`. Every report over an empty scope, and the report-card job, would have been a 500. Caught in the change review of PR A's Task 2, not by a test.
- **Check.** Wherever a queryset is compiled to raw SQL, catch `django.core.exceptions.EmptyResultSet` at the compile and return the empty result without running a query, as `reports._over_days` does. Test it with `.none()` and an empty `__in` under `assertNumQueries(0)`.

### L23. A new custom request header needs the API's CORS allow-list

- **Mistake.** The dashboard began sending `Idempotency-Key` on its writes, but the API never added it to `CORS_ALLOW_HEADERS`, so django-cors-headers' default list refused the browser's preflight and every such write failed as a network error. The mocked lane's router allows the header itself (`e2e/src/mocks/router.ts`), so only the live lane's register and promotion journeys showed it (fixed in #135).
- **Check.** When a client starts sending a new header, grep `CORS_ALLOW_HEADERS` in `apps/api/config/settings/` and add it there, with a preflight test like `apps/api/tests/test_cors_headers.py`. A green mocked lane proves nothing about CORS.

### L24. Behaviour a list serializer or a mixin supplies needs a single-object test too

- **Mistake.** `LeaveRequestSerializer` extended plain `ModelSerializer`, not the names mixin (`UserNamesModelSerializer`), yet called `self.user_name`. Its `list_serializer_class` loaded the names for every list, so each list test passed and hid the bug; only a single-object read, the create's re-read of the new request, raised `AttributeError` and answered 500 (#137, fixed in `8b9f45e5`).
- **Check.** When a serializer's behaviour comes from its `list_serializer_class` or a mixin, test the single-object paths (create, retrieve, an action's response) as well as the list, and confirm the class's bases provide every method it calls.

### L25. A new kind of subject re-opens every identity rule

- **Mistake.** Attendance corrections refused only an approver who had *raised* the request. Staff corrections added a target that is itself a user, so HR could raise a correction to the principal's locked day and the principal could approve their own payroll inputs (PR C, caught in the whole-branch review).
- **Check.** When a workflow gains a target kind, list every party to it (requester, subject, approver) and decide for each segregation-of-duties rule whether it covers them; test the refusal for each party, and expose what the client needs to mirror it (`subject_user_id`).

### L26. A job's task is sent after its row commits

- **Mistake.** Seven `202` + job endpoints (promotion execute, the student, staff and attendance imports, the student and staff exports, ID cards) called `task.delay()` inside the request's transaction (`ATOMIC_REQUESTS`). A fast worker looked the job up before it committed, raised `DoesNotExist`, and the job stayed `queued`; the promotion journey timed out on it in e2e-live run 40454439946. Eager Celery in tests ran the task inside the request, so no backend test could see it. The September audit (C8) had already named the student jobs.
- **Check.** Never send a task inside the transaction that writes the rows it reads. For a job, prefer `core.jobs.services.enqueue_job(job=..., task=...)`, which sends on commit and stores the task id, and cover the endpoint with `core.jobs.tests.base.assert_sent_on_commit`; anything else goes in `transaction.on_commit`.

### L27. A hand-picked e2e identity needs the platform keys its journey reads

- **Mistake.** `seed_e2e_data.py` gives its `school_admin` an exact list of module keys, not the role's registry grants. It left out `platform.job.view`, which every real staff role holds through `core/jobs/permissions.py`, so the promotion journey's job poll was a 403 and the screen reported a job that had succeeded as failed (e2e-live run 40659453170).
- **Check.** When a live journey starts a `202` + job, opens a file or reads any other platform resource, add the matching `platform.*` key to that identity's list in `seed_e2e_data.py`, and confirm with the trace's network log that no request in the journey is a 403.

## 4. Adding a lesson

1. Number it next (`L14`) and give it a short title that states the rule.
2. Write **Mistake** (what happened, with the file, commit or PR) and **Check** (what to do, concrete enough to run). Two to four lines each.
3. Add it to the §2 checklist if it applies to every hand-back.
4. If it overlaps an existing lesson, extend that one instead.
5. If a lint rule, CI job or test now catches it, delete the lesson and link the check from [`tooling.md`](tooling.md) instead.
