# Timetable Dashboard: Implementation Plan

> **For agentic workers:**
> - One implementer pass per task, then one final `change-reviewer` pass and one fix pass per PR.
> - **This repo never runs tests, lint or typecheck locally.** CI is the verifier, so a "test" step means push and read `gh pr checks <n> --watch`.
> - Generators are not checks and must be run: `apps/api/scripts/generate-openapi.sh` and `pnpm --filter @schoolhub/api-client generate`.
> - Lesson L11 overrides for every subagent brief:
>   - stage only your own files, by explicit path;
>   - never create or edit a `.env*` file;
>   - no AI attribution in commits or PRs;
>   - never `--no-verify`;
>   - write the report early and update it as you go.

**Work tier:** 2

**Goal:** Give `timetable` its dashboard:
- period and room setup;
- the section week-grid editor, with click-to-edit plus drag-and-drop and live conflicts;
- validate and publish;
- a substitutions queue with free-teacher candidates, approve, reject and cancel;
- My timetable.

The backend gaps those screens hit close in the same PRs.

**Architecture:** three sequential full-stack PRs, mirroring the academics A/B/C split:

| PR | Branch | Ships |
| --- | --- | --- |
| A | `feat/timetable-setup` | A shared module-sections kit (the third consumer is attendance next), the Timetable shell (sidebar group, `/timetable` layout and tabs, landing redirect), `/timetable/periods` and `/timetable/rooms` |
| B | `feat/timetable-grid` | `/timetable/grid`: the section week grid, cell dialog, drag-and-drop move, conflict panel, validate and publish. Repairs the broken live CUJ |
| C | `feat/timetable-cover` | `/timetable/substitutions` (queue, propose with free-teacher candidates, approve, reject, cancel) and `/timetable/my` |

**Tech stack:** Django 6.1 + DRF 3.18 + drf-spectacular; Next.js 16 / React 19, TanStack Table 8 and Query 5, react-hook-form + zod, next-intl, `@dnd-kit/core` (already a dashboard dependency, unused so far); Jest + RTL; Playwright (mocked `dashboard` project and the nightly `live` lane).

**Spec:**
- `docs/03-modules/timetable.md`: §4, §5–§8, §11, §16, §20.
- `docs/05-database/entities/` (timetable tables).
- `docs/project-status.md` (Tier 2 row, item 12).

**Plan file in the repo:** PR A's first commit copies this plan, with its review block, to `docs/superpowers/plans/2026-10-19-timetable-dashboard.md` (`docs: timetable dashboard plan`).

**Branching:**
- PR A branches from an up-to-date `main`.
- PR B and PR C each branch from `main` once the previous PR has merged.
- If it hasn't merged yet, stack with `gh pr create --base <previous branch>` and retarget to `main` after the merge.

## Context

`project-status.md` names the timetable dashboard as the next pickup now that academics is full-stack complete. Attendance's period mode, and its screens, depend on it.

The backend has been complete since September. The screens were deleted by the shell reset (`8cd8176`, `9548054`). What survived:
- the `timetable` i18n namespace;
- `endpoints.dashboard.myTimetable` and the home widget's `fetchMyTimetable` (`shell/dashboard/team-meeting.tsx`);
- `e2e/src/pages/dashboard/timetable/week-grid.page.ts`;
- the nightly CUJ `e2e/tests/live/timetable-build-publish-journey.spec.ts`, which fails at the "Timetable" nav click today, unrecorded (`project-status.md:35` still lists it).

Backend gaps the UI hits:
- **Payloads and typing:**
  - slot and substitution payloads are ids only;
  - `:validate`, `:publish`, the slot-delete 200 and `meta.conflicts` are untyped.
- **Missing filters:**
  - `/timetable-slots` mixes superseded rows in, and has no current filter or period-sequence ordering;
  - `/periods?campus_id=` excludes tenant-wide periods.
- **Missing rules:**
  - slot writes skip the closed-session lock;
  - confirmed cover can't be released;
  - a rejected substitution blocks that slot and date forever (`substitutions_one_per_slot_per_date`, `models.py:344-348`, ignores status; the auto-proposal skip at `substitutions/services.py:365-367` does too).
- **Lookups and search:**
  - there is no free-teacher lookup;
  - `/teacher-substitutions` advertises `search` with no `search_fields`.

**User decisions (2026-10-19):**
- PR split: Setup → Grid → Cover.
- Grid editing: dialog **and** drag-and-drop.
- Backend in scope: name fields plus typed responses, current filter, `:cancel`, candidates lookup.
- `:cancel`: approvers cancel any `proposed|confirmed` cover; the proposer may withdraw their own `proposed` one. It stays distinct from `:reject`: reject means an approver declines, cancel means the cover is no longer wanted.
- Make the one-per-slot-per-date constraint status-conditional (migration).
- Candidates exclude teachers on approved leave or marked absent that date.
- Cell dialog teacher picker: all active teaching staff, with those allocated to the subject first and an allocation hint. An unallocated pick is allowed and raises the hard conflict, which is the live CUJ's scenario.

**Reference for domain logic only:** read the old screens with `git show 9548054^:apps/dashboard/src/features/timetable/<file>`. Port their decisions, not their code:
- draft-wins cell index;
- visible weekdays;
- inert break and not-running cells;
- `conflictsBySlot`;
- server conflict order;
- conflict text from `conflicts.types.<type>`, with the server message as fallback;
- unknown severity treated as hard;
- no optimistic writes;
- conflicts read from `error.meta.conflicts`, not `details`;
- the slot form's allocation hint.

## Alternatives considered (why not)

- **Restore the deleted screens verbatim.** Rejected. They predate `DataGrid`, URL state, `Services`, `ResponsiveDialog` and generated types, as academics found.
- **Join names on the client from option lists.** Rejected. That means five capped option lists, while the querysets already join the rows. Read-only name fields are one source of truth (academics precedent).
- **Grid on `DataGrid`/TanStack.** Rejected. A period × weekday matrix has no paging or sorting, and cells are the unit. It will be a hand-built `<table>` with real header cells.
- **Drag-and-drop only.** Rejected. Touch users, screen-reader users and the CUJ's cell buttons need the dialog. Drag is an accelerator through a **separate handle**, so clicking or pressing Space/Enter on the cell still opens the dialog.
- **Drag a published cell, or a draft that replaces a published cell.** Deferred. Moving one would leave the published class showing at the source, because a published cell can't be cleared. Only pure drafts (no published row underneath) get a handle. A drop on an occupied cell is refused, never swapped.
- **Allocated-only teacher picker.** Rejected (user, 2026-10-19). It hides the `teacher_not_allocated` conflict the CUJ exercises. Allocated teachers sort first with a hint instead.
- **Keep the substitution constraint status-blind.** Rejected (user, 2026-10-19). With `:cancel` it would add a second permanent dead end. Partial unique on `proposed|confirmed` mirrors `subs_substitute_one_per_period` (`models.py:361-364`).
- **Two "is free" implementations** (a per-teacher check plus a set-based lookup). Rejected. They would drift. A single set of queryset predicates backs the create check, the candidates lookup and the auto-proposal.
- **One `timetable` service module.** Rejected. Separate resources and keys give four modules (`student-transfers` and `teacher-allocations` precedent).
- **Copy academics' tabs and landing into timetable.** Rejected. Timetable is the second copy, and attendance would be the third. PR A hoists them, and the session pieces, into `src/components/module-sections/` and `src/components/academic-session/`.
- **Ranked candidates.** Out of scope. §6's deterministic ranking (qualification, familiarity, load) and AI-TTB-03 are recorded as a spec gap. Candidates come back in stable name order and a human picks.
- **"Uncovered periods today" view, self-approval guard.** Deferred to `deferred-work.md`; the user did not select them.
- **ADR.** Not needed. No new convention is introduced (the hoist is ADR-free reuse), and `:cancel`/`candidates` are additive (api-architecture §2.1).

## Global Constraints

- **Verification:** CI only (`api`, `frontend`, `repo-hygiene`); dispatch `e2e-live` after PR B and PR C.
- **Commits:** Conventional Commits, no AI attribution, `Root cause:` on `fix` commits, and nothing committed or pushed without the user's go-ahead.
- **Generated contract:** the serializer or view change and the regenerated `openapi.yaml` and `schema.d.ts` go in one commit. Wire types are `ApiSchemas[...]` aliases (ADR-0005/0017).
- **Dashboard:** follows the `schoolhub-dashboard-screen` and `schoolhub-api-services` skills:
  - five-file service modules, with query-key module and resource **constants**, never literals;
  - `useDataGridUrlState` for lists, `useUrlParams` for the grid's session, class and section;
  - `FormDialogLayout` + `useFormDialogSubmit`, and `useConfirmAction` + `ResponsiveAlertDialog`;
  - conditionally mounted dialogs;
  - shared selects and inputs, and the `use-reference-data` hooks;
  - a locked session is read-only;
  - theme tokens only;
  - i18n in `en` and `ur`, reusing `common.*`;
  - fewer than 400 lines per file;
  - named constants for magic values (the visible-weekdays default, the drag activation distance).
- **Page-number lists** (periods, rooms, substitutions) aren't walked by `collectPages`. The grid's periods and the room picker request `page_size=MAX_PAGE_SIZE`, and the cap is stated in a comment.
- **Backend:**
  - an explicit `required_permission_map` entry for every new action (an unmapped action falls back to `timetable.timetable.view`, which every role holds);
  - a cross-tenant 404 test per new endpoint;
  - `select_related` with an `assertNumQueries` test for each list;
  - a staff full name from one `Staff.full_name` property in `staff_management`, never another copy of the formatting;
  - templates named `timetable.<event>`.
- **Permissions:**

  | Section / action | Key |
  | --- | --- |
  | Periods tab; writes | `timetable.period.update`; `timetable.period.*` |
  | Rooms tab; writes | `timetable.room.update`; `timetable.room.*` |
  | Grid tab, `:validate` | `timetable.slot.view` |
  | Fill, edit, move, remove a draft cell | `timetable.slot.create` / `update` / `delete`, gated **separately** from publish |
  | Publish | `timetable.timetable.publish` only, with an unlocked session (the principal has publish + `slot.view` but no `slot.create`) |
  | Substitutions tab | any of `timetable.substitution.create`, `timetable.substitution.approve` |
  | Propose, candidates | `timetable.substitution.create` |
  | Approve, reject | `timetable.substitution.approve` |
  | Cancel | `approve`: any `proposed|confirmed`; `create`: only the caller's own `proposed` row |
  | My timetable tab | `timetable.timetable.view` (every tenant role, per §4; a non-teaching staff member sees an empty state) |

- **Docs ship in each PR:** `timetable.md` §4, §16 and §20, `project-status.md`, `deferred-work.md`, `agent-lessons.md` for any catch, and `apps/dashboard/AGENTS.md`'s wiring table for the hoisted kits.

## Review Focus

1. **Draft-wins index:** the cell shows the draft, with a "changed since publish" marker. Tests: Task 6.
2. **Current filter:** `current=true` means `effective_to IS NULL` (drafts and live published), never superseded rows. Tests: Task 5.
3. **Drag rules:**
   - Only pure drafts have a handle.
   - The target must be empty, not a break, and running on that weekday.
   - An invalid drop makes no request.
   - A valid drop sends a single PATCH and shows the returned conflicts.
   - Tests: `resolveDrop` in Jest (Task 7); real pointer and keyboard drags in Playwright (Task 8).
4. **Publish:** visible to a publish-only principal. A 422 fills the panel from `error.meta.conflicts` and keeps the confirm open. Tests: Tasks 6–7.
5. **`:cancel`:**
   - The transitions and both permission paths.
   - Only today or later.
   - A locked re-read plus a conditional UPDATE.
   - 409 on a second cancel.
   - Notifies the substitute.
   - After a cancel or a reject, the same slot and date can be proposed again (constraint migration).
   - Tests: Task 9.
6. **Free teacher:**
   - One set of predicates covering: same campus, active teaching staff, not the absent teacher, no current published slot at that weekday and period, no `proposed|confirmed` cover then, not on approved leave covering the date, not marked absent that date.
   - Shared by `create_substitution`'s check (which keeps its field-specific messages), `candidates`, and `_first_free_substitute`.
   - Tests: Task 9.
7. **Closed session:** slot create, update and delete re-raise `assert_session_writable` as a 422 on `academic_session_id`. A PATCH checks both the old and the new session. Tests: Task 5.

---

# PR A: Setup (shared kits, shell, periods, rooms)

### Task 1: Backend: setup contract
**Files:** `apps/api/apps/timetable/{rooms,periods}/{serializers,filters,viewset}.py` and `tests/`; `apps/api/apps/staff_management/models.py` (`Staff.full_name`) with its existing callers switched (`academics/teacher_allocations/{serializers,viewset}.py`, `timetable/slots/serializers.py`); regenerate.
- [ ] Serialize the annotated `campus_name` (read-only, nullable) on `Room` and `Period`.
- [ ] Periods: add a `for_campus` filter, meaning the campus's own periods **plus** tenant-wide ones. `campus_id` keeps exact-match.
- [ ] Tests: names present; `for_campus` includes tenant-wide periods; cross-tenant 404s; flat query count; `full_name` formatting.
- [ ] **Amended after PR A's change review (2026-10-19):** removing a period or room is a soft delete, which `on_delete=PROTECT` never sees, so the dashboard copy "a period/room in use cannot be removed" was false and PR B's grid (drawn from alive periods) would lose live cells. `periods/services.assert_period_not_in_use` and `rooms/services.assert_room_not_in_use` refuse (422, non-field) a row a current grid cell (`effective_to IS NULL`) or upcoming `proposed|confirmed` cover still uses; `perform_destroy` calls them. Superseded cells are history and don't count. Tests: refused for a current cell and for upcoming cover, allowed when only superseded cells used it.

### Task 2: Dashboard: hoisted kits and the Timetable shell
**Files:**
- **Create** `src/components/module-sections/` (`module-sections.ts`, `module-section-nav.tsx`, `module-landing.tsx`), from `features/academics/academics-{sections,nav,landing}`.
- **Move** `use-academic-session.ts`, `session-picker.tsx` and `no-session-card.tsx` to `src/components/academic-session/`.
- Switch academics onto both (no behaviour change; its tests are the regression net).
- **Modify** `packages/ui/src/lib/menu-types.ts` (`permission: string | string[]`, any-of) and `app/(app)/shell/menu-access.ts` with its tests.
- **Create** `features/timetable/timetable-sections.ts` and `app/(app)/timetable/{layout,page}.tsx`.
- **Modify** `config/paths.ts`, `config/menu-config.ts` (a Timetable group, `module: "timetable"`) and both message files.
- **Modify** `apps/dashboard/AGENTS.md` (kits in its wiring table).

Steps:
- [ ] Section permission is `PermissionKey | PermissionKey[]` (any-of) through to the sidebar.
- [ ] The landing sends a user who only has `timetable.timetable.view` to `/timetable/my`.
- [ ] Tests: the kit (filtering, any-of, denied, loading and failed), `filterMenuByAccess` any-of, and academics unchanged.

### Task 3: Dashboard: periods and rooms
**Files:** `services/modules/{periods,rooms}/*` (registered); `features/timetable/periods/*` and `features/timetable/rooms/*` (toolbar, filters, table, columns, form dialog, delete confirm); `app/(app)/timetable/{periods,rooms}/page.tsx`; tests.
- [ ] Periods:
  - list in sequence order, with "All campuses" for a null campus;
  - the weekdays `ToggleGroup` hint keeps the existing `periods.form.weekdaysHint` wording ("none selected = the tenant's working days");
  - start/end overlap 422s map onto their fields.
- [ ] Rooms: an `is_active` switch, delete through a confirm, and campus, type and active filters.
- [ ] Tests: create versus edit clearing, server errors under their field, action gating, and the URL round trip.

### Task 4: E2E, docs, PR A
**Files:** `e2e/src/mocks/domains/timetable-setup.ts`; `e2e/src/pages/dashboard/timetable/{periods,rooms}.page.ts` plus barrels; `e2e/tests/dashboard/timetable-setup.spec.ts`; docs.
- [ ] Mocked spec: period and room CRUD, the overlap field error, and a no-key viewer.
- [ ] Docs: §20 (shell and setup), §16 (`for_campus`, names). In `project-status.md` and `deferred-work.md`, record that the build-and-publish CUJ is stale until PR B.
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI.

---

# PR B: Section week grid

### Task 5: Backend: grid contract and rules
**Files:** `apps/api/apps/timetable/slots/{serializers,filters,viewset,services}.py` and tests; regenerate.
- [ ] `TimetableSlot` gains read-only `section_name`, `subject_name`, `staff_name` (via `Staff.full_name`), `room_name`, `period_name`, `period_sequence`, `start_time`, `end_time`, with `select_related`.
- [ ] A `current` boolean filter, plus `period_sequence` ordering (annotated alias).
- [ ] Add a `TimetableConflict` serializer and these typed responses:
  - `:validate` → `TimetableValidation`;
  - `:publish` → `TimetablePublishResult`;
  - the 422 error with `meta.conflicts`;
  - DELETE 200.
- [ ] Slot-write `meta.conflicts` is read through a single client helper typed `ApiSchemas["TimetableConflict"][]`. This is academics' recorded `meta.warnings` exception, now on a generated item type.
- [ ] **Amended after PR B's change review (2026-10-19):** the DELETE 200 and the publish 422 stay *described*, not typed. Both carry their findings in an envelope's `meta` (a success's `meta.conflicts`, an error's `error.meta.conflicts`), and this repo's schema describes no endpoint's envelope `meta`; the item type is the generated `TimetableConflict` (from `:validate`), applied by `conflictsFromMeta`/`conflictsFromError`. Typing one envelope here would be a one-off shape every other endpoint lacks.
- [ ] Slot create, update and delete re-raise `assert_session_writable` as a field error on `academic_session_id`. A PATCH checks both the old and the new session (precedent `academics/teacher_allocations/services.py:197,224`).
- [ ] Tests:
  - names;
  - `current`;
  - ordering;
  - the closed-session 422 per verb, including a PATCH into a locked session;
  - the schema;
  - flat query count;
  - 404s.

### Task 6: Dashboard: grid data and cell editing
**Files:**
- `services/modules/timetable-slots/*`: list via `collectPages`, write, validate, publish, `conflictsFromMeta` and `conflictsFromError`, plus `TIMETABLE_SLOTS_QUERY_MODULE`.
- `features/timetable/grid/`:
  - `grid-toolbar.tsx`: session, class and section pickers in the URL; Check for conflicts; Publish;
  - `use-week-grid.ts`: periods with `for_campus` and `page_size=MAX_PAGE_SIZE`; slots with `current=true`; the draft-wins index; `DEFAULT_VISIBLE_WEEKDAYS` plus any weekday that has a slot;
  - `week-grid.tsx`: cell buttons named `Fill {weekday} · {period}` / `Edit {weekday} · {period}`;
  - `slot-cell.tsx`;
  - `slot-form-dialog.tsx`: subject, then a teacher (all teaching staff via `features/academics/allocations/use-teaching-staff-options.ts`, those allocated to this section and subject first, with the `slot.form.allocationHint`), then a room (active rooms, capped list), then notes;
  - `remove-draft-dialog.tsx`.
- `app/(app)/timetable/grid/page.tsx` and tests.

Steps:
- [ ] Editing a published cell POSTs a draft over it; editing a draft PATCHes it; Remove applies to drafts only. No optimistic writes.
- [ ] Break and not-running cells are inert and labelled.
- [ ] Cell editing is gated on `slot.*`. Publish is gated on `timetable.timetable.publish` plus an unlocked session, independent of cell editing.
- [ ] Tests:
  - the index;
  - weekdays;
  - fill, edit and remove;
  - 422 under its field;
  - allocated-first ordering;
  - a publish-plus-`slot.view` user sees Publish and inert cells;
  - a locked session is read-only.

### Task 7: Dashboard: drag-and-drop, conflicts, publish
**Files:** `features/timetable/grid/{grid-dnd.tsx,resolve-drop.ts,conflict-panel.tsx,publish-dialog.tsx,use-grid-conflicts.ts}` and tests.
- [ ] **dnd-kit, with a separate handle per pure-draft cell:**
  - `setActivatorNodeRef`, named `Move {weekday} · {period}`, with `touch-action: none` on the handle only, so the grid still scrolls on touch;
  - `PointerSensor` with a `DRAG_ACTIVATION_DISTANCE` constraint;
  - `KeyboardSensor` with a custom coordinate getter that steps between droppable cells;
  - translated `announcements`;
  - reuse `packages/ui/src/components/data-grid-dnd-rows.tsx`'s sensor setup where it fits.
- [ ] The pure `resolveDrop(source, target, cellIndex)` decides valid or invalid (with a reason). A valid drop sends one PATCH; an invalid one announces the reason and makes no request.
- [ ] **Conflict panel:**
  - the findings render in `role="list"` named "Conflicts";
  - "No conflicts found." renders **outside** the list, so the CUJ's "list is gone" assertion holds;
  - `conflictsBySlot` highlights with the `danger`/`warning` tokens plus an icon;
  - selecting a finding focuses its cell.
- [ ] **Publish confirm** (`useConfirmAction`):
  - a 422 fills the panel and keeps the message;
  - success shows `Published {n} periods.` and invalidates the slots module constant **and** the My-timetable key.
- [ ] Tests: `resolveDrop` (each refusal reason); conflict mapping (unknown severity counts as hard, server order kept, translate-or-fallback); publish success and 422.

### Task 8: E2E, docs, PR B
**Files:** `e2e/src/mocks/domains/timetable-grid.ts`; `e2e/tests/dashboard/timetable-grid.spec.ts`; `week-grid.page.ts`; `timetable-build-publish-journey.spec.ts`; `e2e/src/lib/live-timetable-grid.ts`; `e2e/src/pages/dashboard/dashboard.page.ts` if `navGroup` needs it; docs.
- [ ] Page object and CUJ:
  - `path` becomes `/timetable/grid`;
  - add the Class picker;
  - the CUJ opens the Timetable sidebar group via `navGroup`, then "Week grid" (the existing `timetable.nav.grid` label);
  - publish confirms inside `alertdialog` (the `PromotionBatchPage.confirm()` pattern);
  - `sectionTab` stops hardcoding "Academics sections";
  - fix the stale "end-dates every published slot" comments in the spec and helper.
- [ ] Mocked spec:
  - fill, conflict, fix, validate, publish;
  - a pointer drag stepped past the activation distance;
  - a keyboard drag via the handle;
  - Space on a cell opens the dialog, not a drag;
  - a published cell has no handle.
- [ ] Docs:
  - §20 grid as shipped;
  - §16 (`current`, ordering, typed actions, closed-session rule);
  - `project-status.md`: the CUJ is live again;
  - `deferred-work.md`: dragging published or replacement drafts, swap on drop, the weekly-target indicator.
- [ ] `change-reviewer` → fix → go-ahead → PR → CI → dispatch `e2e-live` and report the result.

---

# PR C: Cover (substitutions, My timetable)

### Task 9: Backend: substitutions contract, constraint, `:cancel`, candidates
**Files:** `apps/api/apps/timetable/{models.py, migrations/00NN_substitution_active_unique.py}`; `substitutions/{serializers,viewset,urls,services,filters}.py`; `permissions.py` (registry descriptions); `notifications.py` plus the template registry; `apps/attendance/services.py` (a read-only `unavailable_staff_ids(on_date)`); `slots/viewset.py` (`/timetables/my` meta typing); tests; regenerate.
- [ ] **Migration:** `substitutions_one_per_slot_per_date` becomes partial on `status IN (proposed, confirmed)`. The auto-proposal "already covered" skip uses the same filter.
- [ ] **Names:** `absent_staff_name`, `substitute_staff_name`, `section_name`, `subject_name`, `period_name`, `day_of_week`, `slot_room_name` (the timetabled room) and `room_name` (the cover's own room change). Extend `select_related` with `timetable_slot__subject`, `timetable_slot__room` and `room`. Add `search_fields` for the staff names.
- [ ] **Free-teacher predicates:**
  - a single `free_substitutes(slot, on_date)` queryset, set-based;
  - it excludes `unavailable_staff_ids(on_date)` from `attendance.services` (approved leave covering the date, or `absent` staff attendance), imported inside the function because attendance already imports timetable services (ADR-0013: an app's services, not its tasks or views);
  - `_assert_substitute_is_free` filters the same queryset to one teacher and keeps its field messages;
  - `_first_free_substitute` is `free_substitutes(...).order_by("pk").first()`.
- [ ] **`POST /teacher-substitutions/{id}:cancel`:**
  - mapped explicitly;
  - an approver may cancel `proposed|confirmed`, while a `substitution.create` holder may cancel only their own `proposed` row; anyone else gets a 404 if the row is out of scope, or a 403 for a missing key (per the permission class);
  - date ≥ today;
  - a locked re-read plus a conditional UPDATE, 409 otherwise;
  - audited;
  - notifies the substitute (`timetable.substitution-cancelled`).
- [ ] **`GET /teacher-substitutions/candidates?timetable_slot_id=&date=`:**
  - routed **before** the router (precedent `academics/teacher_allocations/urls.py:22-30`);
  - mapped to `timetable.substitution.create`;
  - the slot is resolved through `scope_queryset`, so it is a 404 outside the caller's campus;
  - 422 for a slot that isn't published or a date whose weekday doesn't match;
  - returns `[{staff_id, staff_name, employee_number}]` ordered by name.
- [ ] Type `/timetables/my`'s envelope meta (`audience`, `academic_session_id`, `date`).
- [ ] Tests:
  - every `:cancel` transition and both permission paths;
  - a past date, and a double cancel;
  - cancel then re-propose, and reject then re-propose;
  - each candidate exclusion (busy, already covering, other campus, inactive, absent teacher, on leave, marked absent);
  - the auto-proposal picks the first candidate;
  - candidates' campus-scope 404;
  - flat query counts;
  - cross-tenant 404s.

### Task 10: Dashboard: substitutions queue
**Files:** `services/modules/teacher-substitutions/*`; `features/timetable/substitutions/` (toolbar with Propose, filters for status and date range, table, columns, `propose-substitution-dialog.tsx`, `substitution-action-dialog.tsx`); `app/(app)/timetable/substitutions/page.tsx`; tests.
- [ ] Propose chain:
  1. date and absent teacher;
  2. the slot (`/timetable-slots?teacher_id&status=published&current=true&weekday=`);
  3. the substitute, from `candidates` (an empty state when nobody is free);
  4. optionally a room and a reason.
  Each step resets the later ones.
- [ ] Row actions gated on key, status and ownership: approve and reject on `proposed`; cancel per the permission table, with date ≥ today. A 409 reloads the row.
- [ ] Tests: the chain resets; action gating, including the proposer withdrawing their own row; the 409 path.

### Task 11: Dashboard: My timetable
**Files:** `features/timetable/my/{my-timetable.tsx,my-today.tsx}` (reusing the grid's read-only rendering); `app/(app)/timetable/my/page.tsx`; `Services.timetableSlots.fetchMyTimetable`, replacing the `dashboard` copy, with `shell/dashboard/team-meeting.tsx` and its two tests plus `services/__tests__/endpoints.test.ts` updated; tests.
- [ ] Two reads:
  - the week from `/timetables/my` with no date;
  - a Today panel from `?date=today`, showing cover badges (`substitute_staff_name`, room).
  - Cells use the server's names, so the view needs no reference-list requests.
- [ ] Tests: cover in, cover out; an empty timetable for a non-teaching role.

### Task 12: E2E, docs, PR C
**Files:** `e2e/src/mocks/domains/timetable-cover.ts`; `e2e/tests/dashboard/timetable-{substitutions,my}.spec.ts`; extend `e2e/tests/live/api/timetable.spec.ts` (`:cancel`, `candidates`, re-propose after reject); docs.
- [ ] Docs:
  - `timetable.md` §4 (cancel rights), §7.2 (cancel, re-propose), §12 (new template), §16 and §20;
  - `project-status.md`: timetable full-stack complete, next is the attendance dashboard;
  - `deferred-work.md`: close "completed/cancelled unreachable" (note `completed` is still unreachable); add the uncovered-periods view, the self-approval guard, and §6/AI-TTB-03 ranking as a spec gap.
- [ ] `change-reviewer` → fix → go-ahead → PR → CI → dispatch `e2e-live`.

## Verification

- **Per PR:** `api`, `frontend` (lint, typecheck, Jest with an 85% floor, build, mocked Playwright) and `repo-hygiene` are green on `gh pr checks <n> --watch`. On failure, read `gh run view <id> --log-failed`, and re-run once for an environment flake.
- **Manual (local stack, `seed_e2e_data`, seeded admin):**
  - **PR A:** an overlapping period shows the field error.
  - **PR B:**
    - Fill the seeded section with an unallocated teacher; see the hard conflict and the blocked publish.
    - Fix it, publish, reload.
    - Drag a draft cell by mouse and by keyboard handle.
    - As the principal, Publish is visible and the cells are inert.
  - **PR C:**
    - Propose cover from the candidates (a teacher on leave is absent from the list) and approve it.
    - Check it on the teacher's My timetable, then cancel it and re-propose.
- **Nightly `e2e-live`:** after PR B (the CUJ) and PR C (the API journeys).
- **After code changes:** `graphify update .`.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-19
- **Verdict:** REVISE — right split and reuse, but Publish is hidden from the principal, cancel/reject leave a slot impossible to cover again on that date (`substitutions_one_per_slot_per_date`), and drag-and-drop collides with click-to-edit; plus gaps in the live CUJ/page object, sidebar any-of, candidates routing/permissions/scope, and N+1 on substitution names.
- **Findings addressed:** all 21 were folded in.
  1. **Publish hidden from the principal.** Publish is gated on `timetable.timetable.publish` plus an unlocked session only. Cell editing is gated separately. Jest case added (Task 6).
  2. **No re-cover after reject or cancel.** Partial-unique migration, plus the auto-proposal skip, plus re-propose tests (Task 9; user decision).
  3. **Drag collides with click.**
     - Fix: a separate handle (`setActivatorNodeRef`), `touch-action: none` on the handle only, a pointer distance constraint, and a cell-stepping keyboard getter (Task 7).
     - Test: Space on a cell opens the dialog (Task 8).
  4. **Allocation-filtered picker.** All teaching staff, allocated first, with the hint (user decision; Task 6).
  5. **CUJ and page-object gaps.** `alertdialog` confirm, "No conflicts found." outside the list, `sectionTab`, `navGroup`, the "Week grid" label, and the helper's stale comment are all in Task 8.
  6. **Sidebar any-of.** `menu-types.ts` and `menu-access.ts` plus tests are in Task 2.
  7. **Substitution N+1 and room ambiguity, duplicated name formatting.** Extended `select_related`, `slot_room_name` versus `room_name`, a single `Staff.full_name` (Tasks 1, 9).
  8. **Candidates routing, permission map, scope, leave and absence.** Routed before the router, an explicit map entry, `scope_queryset`, leave and absence excluded (user decision; Task 9).
  9. **Two "is free" rules.** Shared predicates across the check, the lookup and the auto-proposal (Task 9).
  10. **Closed-session rule.** Re-raised on the field; a PATCH checks both sessions (Task 5).
  11. **jsdom can't prove drags.** Pure `resolveDrop` in Jest, real drags in Playwright (Tasks 7–8).
  12. **Draft replacing a published cell reverts the source.** Only pure drafts are draggable; the rest is deferred (Alternatives, Task 8 docs).
  13. **Page-number pagination.** `MAX_PAGE_SIZE` stated (Global Constraints).
  14. **Weekdays wording and magic Mon–Fri.** Kept the model's hint wording; `DEFAULT_VISIBLE_WEEKDAYS` (Tasks 3, 6).
  15. **Kit placement and session pieces.** Both hoisted under `src/components/`, recorded in `apps/dashboard/AGENTS.md`, third-consumer reasoning stated (Task 2).
  16. **Query-key literal, home widget not refreshed.** A constant, plus the My-timetable key invalidated on publish (Task 7).
  17. **`fetchMyTimetable` move file list.** Listed (Task 11).
  18. **Two wrong premises.** The `reason` nullability "fix" was dropped, and the server-names rationale was corrected (Task 11).
  19. **`:cancel` versus `:reject` and who cancels.** User decision: approvers cancel any; the proposer withdraws their own `proposed` row. Registry and §4 updated (Tasks 9, 12).
  20. **§6 ranking.** Recorded as a spec gap (Alternatives, Task 12).
  21. **L11 brief overrides.** Added to the header.
- **Unresolved:** none.
  - User decisions (2026-10-19): Setup → Grid → Cover; dialog plus drag; all four backend fixes; cancel rights; the constraint migration; excluding leave and absence; the all-staff picker with allocated first.
  - "Should every staff role see My timetable" is resolved by §4 (`timetable.timetable.view` is held by all tenant roles), with an empty state for non-teaching roles.
