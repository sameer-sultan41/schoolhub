# Student Creation Stepper — Design

> **Agent Context:** Redesigns the dashboard's "Add Student" flow into a multi-step
> wizard so a user creating a student can optionally add guardians, emergency
> contacts, documents, and enroll them in one guided flow, instead of creating the
> student then separately reopening the detail sheet and switching tabs. Read this
> before touching `student-form-dialog.tsx`, `student-directory-table.tsx`, or
> anything under `apps/dashboard/src/features/students/`.

**Work tier:** 2

**Review:** waived by user — the user's explicit instruction for this phase was to
compress brainstorming → spec → plan into a single cycle and proceed straight to
implementation, with no `plan-reviewer` pass or further review rounds. See the
spec's own "Independent review" section below and the plan's "Outcome" section for
what stood in for it (self-review against this spec's own checklist).

## Context

Today, creating a student (`StudentFormDialog`, `mode="create"`) captures only
profile fields (name, DOB, gender, campus, house, admission date, address, photo).
Guardians, emergency contacts, documents, and enrollment are each a separate tab
inside `StudentDetailSheet`, reachable only after the student already exists in the
directory — a user who wants to set all of this up for a new student has to create
them, close the dialog, find the row, reopen the detail sheet, and work through four
more tabs one at a time.

This is exactly the sequence `docs/03-modules/student-management.md` §7.1 already
documents as the intended admission flow — "Create student + guardians + documents
from application data" → "Enroll: session + class + section chosen" — written for a
future admissions-module handoff that doesn't exist yet. This phase builds that
sequence into the direct-registration path the dashboard already has, rather than
waiting on the admissions module.

**A real backend constraint, confirmed in `apps/api/apps/student_management/`,
drives the whole design:** there is no atomic batch-create endpoint. Guardians
(`POST /students/{id}/guardians`), emergency contacts (`POST /students/{id}
/emergency-contacts`), documents (`POST /students/{id}/documents`), and enrollment
(`POST /students/{id}:enroll`) all require a real student id — `urls.py:38-53`.
`enroll_student` additionally requires at least one guardian **and** one emergency
contact to already exist (`services.py:531-540`, `assert_enrollment_prerequisites`);
documents are never required. This means the student record is created for real the
moment the wizard's first step completes — there is no "submit everything at the
end" to fall back on, and the design has to be honest about that rather than imply
otherwise.

## Goals

- Let a user add a student and, in the same flow, optionally link guardians, add
  emergency contacts, upload documents, and enroll them — without leaving a single
  dialog.
- Every step after Profile is optional. A user can go straight from Profile to
  closing the wizard and the student exists exactly as they do today.
- Reuse the already-built, already-tested tab components
  (`StudentGuardiansTab`/`StudentEmergencyContactsTab`/`StudentDocumentsTab`/
  `StudentEnrollmentTab`) as each step's body rather than rewriting four new forms.
- Hide a step entirely when the current user lacks the permission it needs, rather
  than showing a step they can't act on.

## Non-goals

- **Edit mode is unchanged.** `StudentFormDialog` in `mode="edit"` keeps its current
  single-page form; a wizard makes no sense for editing one existing student's
  profile fields.
- **No atomic rollback.** If the user closes the wizard after Profile but before
  finishing later steps, the student stays created — there is no "cancel and delete
  everything" semantics, because the backend has no student-delete endpoint at all
  (withdrawal is a status change, not deletion) and partial creation is the expected,
  supported outcome of this flow, not an error state.
- **No new backend endpoints or validation.** Every step calls the same services and
  endpoints the existing detail-sheet tabs already call. The only new backend-facing
  code is the Profile step's existing `createStudent` call, unchanged from today.
- **Not building the admissions module.** This phase builds the *registration* path
  the dashboard already has (a staff member adding a student directly) into a guided
  flow; it does not add an external application/admission-request intake.

## Architecture

### New shared primitive: `Stepper` (`packages/ui`)

No stepper/wizard primitive exists anywhere in this repo today. Per
`packages/ui/AGENTS.md`'s sourcing rule, port Metronic's
`components/ui/stepper.tsx` rather than hand-roll one. The two mandatory
adaptations on every port apply: logical direction (a horizontal stepper's "next"
affordance is `end`, not `right`, so it mirrors correctly in Urdu) and no hardcoded
English (step labels, a "current step" `sr-only` announcement, etc. become required
props/children, never a defaulted string).

Shape: a `Stepper` root holding the ordered list of steps (each with a label and a
`status` of `"complete" | "current" | "upcoming"`), visually a horizontal row of
numbered/checked circles connected by a line, collapsing to a simpler
label-plus-progress treatment on narrow/mobile widths (same desktop/mobile split
convention `ResponsiveDialog` already uses, via `useIsDesktopShell()`). It is a
**presentational** primitive only — it renders the step list and current position;
it does not own navigation logic or step content, matching how `Tabs` doesn't know
what's inside a `TabsContent`.

### Orchestrator: `StudentCreateStepper` (`apps/dashboard/src/features/students/`)

Replaces `StudentFormDialog` as the "Add Student" button's target (create mode
only — the directory's "Edit" action still opens `StudentFormDialog` in edit mode,
unchanged). Owns:

- `currentStep: number` and the derived step list (profile is always present;
  guardians/emergencyContacts/documents/enrollment are each included only if the
  current user holds the matching permission — `students.guardian.create`,
  `students.student.update` [emergency contacts reuse this key, confirmed, not a
  dedicated one], `students.document.create`, `students.enrollment.enroll`).
- `studentId: string | null` and `campusId: string | null` — `null` until the
  Profile step's `createStudent` mutation resolves; every step after Profile is
  unreachable (the stepper can't advance past Profile) until both are set.
- A **persistent banner**, visible on every step from Guardians onward, naming the
  created student and making explicit that they already exist: `{t("stepper
  .studentCreated", { name })}` — e.g. "Ayesha Khan has been created. Add more
  details below, or finish now." This is the one piece of UI carrying the weight of
  the "no atomic rollback" non-goal above; closing the wizard after this point is a
  real, supported exit, not an abandoned operation.

Navigation is **Back / Next** only — no separate "Skip" action. On Profile, Next
runs the existing `createStudent` mutation (the same `buildStudentInput`/
`studentFormSchema` the current create dialog already uses) and only advances on
success, surfacing the same field-level and `non_field` error handling
(`applyServerFieldErrors`) the current dialog has. On every later step, Next simply
advances regardless of whether the user added anything on that step — adding zero
guardians and clicking Next has the same effect a dedicated "Skip" button would,
so one button covers both. The last visible step's advance button reads "Finish"
(`tCommon("finish")`) instead of "Next" and closes the wizard, invalidating the
student directory list query exactly like today's create flow.

**Back never returns to Profile once it's submitted.** Profile is a one-way
door: it's a real `POST /students` that already happened, and `StudentFormDialog`'s
create-mode fields were never designed to be revisited as an edit form (editing an
existing student is `StudentFormDialog`'s own `mode="edit"`, a separate dialog, out
of scope here per Non-goals). Once `studentId` is set, Profile renders in the
Stepper's trail as a completed step with no click handler; Back is only enabled
between steps 2-5 (e.g. Documents back to Emergency Contacts), never back to
step 1.

### Step bodies: thin wrappers around the existing tab components

Each step from Guardians onward renders the **same component** `StudentDetailSheet`
already uses for that tab, pointed at the stepper's `studentId`:

| Step | Renders | Props |
| --- | --- | --- |
| Guardians | `StudentGuardiansTab` | `studentId`, `canCreate`/`canUpdate` from `hasPermission` |
| Emergency Contacts | `StudentEmergencyContactsTab` | `studentId`, `canCreate` |
| Documents | `StudentDocumentsTab` | `studentId`, `canCreate`/`canVerify`/`canDelete` |
| Enrollment | `StudentEnrollmentTab` | `studentId`, `campusId`, the same `StudentEnrollmentTabPermissions` shape `StudentDetailSheet` already builds |

None of these four components change. This is the design's central simplification:
the stepper is new *sequencing and navigation* around already-shipped, already-
tested feature code, not four new forms.

**The Enrollment step's own prerequisite failure is not special-cased.** If the
user skipped Guardians and Emergency Contacts and then clicks "Enroll" on the last
step, `enroll_student` returns its real `DomainRuleViolation` ("Student needs at
least one guardian before enrolling") and `StudentEnrollmentTab`'s existing error
handling shows it exactly as it does today inside the detail sheet. No client-side
check blocks reaching this step or disables its controls — the real server error is
the only guard, consistent with every other business rule in this codebase never
being duplicated client-side.

### Permission gating

A step is omitted from the stepper entirely — not shown-but-disabled — when the
current user lacks its action permission. Profile is always present (creating a
student is the wizard's entry condition). If a user holds only
`students.student.create` and none of the other four keys, the wizard is just
Profile → Finish, functionally identical to today's dialog.

### State ownership and reset

The stepper is a fresh component instance per open (same "mount a fresh instance
per open" convention `WithdrawStudentDialog` and this phase's own transfer dialogs
already use) — closing and reopening "Add Student" always starts a brand-new wizard
at Profile with no `studentId`, never resuming a previous half-finished session.
There is no persisted draft across a close/reopen; the created-student banner is the
only continuity signal, and it points at a real row the user can always find in the
directory afterward.

## Error handling

- **Profile step validation/submission errors**: unchanged from today's
  `StudentFormDialog` create mode — the same schema, the same
  `applyServerFieldErrors` mapping, the same duplicate-admission 422 handling.
- **Later-step errors**: unchanged from today's detail-sheet tabs — each tab
  component already owns its own mutation error handling; the stepper does not
  intercept or reinterpret it.
- **Enrollment prerequisite 422**: surfaces via `StudentEnrollmentTab`'s existing
  `non_field` error display, same as inside the detail sheet. No new copy needed.
- **Network/navigation away mid-wizard**: since every step after Profile already
  persisted its own data via its own real API call the moment the user added it
  (there is no local-only draft state for guardians/contacts/documents), closing the
  wizard at any point loses nothing already submitted — only whatever was being
  typed into an still-open, not-yet-submitted form within the current step's own
  tab component (the same as closing the detail sheet mid-edit today).

## Testing strategy

- **Jest**: `StudentCreateStepper`'s own step-sequencing logic — advancing from
  Profile only after `createStudent` resolves, correctly omitting steps per
  permission combination, the "Finish" label on the last visible step, the
  created-student banner appearing from Guardians onward. The four step bodies
  themselves need no new tests — their existing test files already cover them.
- **E2E mocked**: one new spec exercising the full happy path (create → add a
  guardian → add an emergency contact → upload a document → enroll → Finish) and
  one permission-gated case (a role with only `students.student.create` sees
  Profile → Finish only).
- **E2E live**: extend the existing admission-journey live spec
  (`students-admission-enrollment.spec.ts`) to drive the new stepper instead of the
  separate dialog-then-sheet sequence it currently drives, since this *is* now the
  real shipped UI for that journey.

## Alternatives considered

- **A single "submit everything" form instead of a stepper**, deferring all API
  calls until one final submit. Rejected: the backend has no batch-create endpoint,
  so this would require either inventing one (a real backend change, out of scope —
  see Non-goals) or faking atomicity client-side with a complex rollback-on-
  partial-failure story the backend can't actually support (there's no student-
  delete endpoint to roll back to). A stepper that creates the student immediately
  and treats every later step as already-real is simpler and matches what the
  backend can actually do.
- **Writing new, purpose-built forms for each step** instead of reusing
  `StudentGuardiansTab`/etc. Rejected: those components already handle their own
  queries, mutations, empty states, and permission checks correctly (they're the
  real, shipped detail-sheet tabs) — duplicating that logic in new step-specific
  components would be pure risk (two implementations to keep in sync) for no
  benefit.
- **Blocking the Enrollment step client-side** when no guardian/contact exists yet,
  rather than letting the real 422 surface. Rejected for the same reason the rest of
  this codebase never duplicates a server-side business rule client-side: the
  server is the single source of truth for "can this student be enrolled," and a
  client-side gate would need to be kept in sync with `assert_enrollment
  _prerequisites` by hand.
- **A persisted draft letting a user resume a half-finished wizard later.** Rejected
  as unnecessary complexity: because Profile already creates a real student and
  every later step already persists via its own real API call the instant it's
  used, there's nothing meaningful left to "resume" — the student and whatever was
  already added are already sitting in the directory/detail sheet, reachable the
  normal way.

## Docs

- `docs/03-modules/student-management.md` §20 ("as shipped") — note the direct-
  registration stepper now implements the §7.1 admission-handoff sequence for the
  non-admissions-module path.
- `docs/project-status.md` — student-management row.
- `apps/dashboard/messages/en.json`/`ur.json` — new stepper step labels, the
  created-student banner copy, "Finish" button label (if not already covered by
  `tCommon`).

## Independent review

Not run. The user's explicit instruction for this phase was to compress the
brainstorming → spec → plan sequence into a single cycle and proceed straight
to implementation without a `plan-reviewer` pass or further review rounds —
self-review against the spec (placeholder scan, type consistency, Review
Focus coverage) was the only review gate, per `superpowers:writing-plans`'
own Self-Review checklist, and caught three real issues before
implementation (see the plan's own Self-Review section). Recorded here
rather than left silent, since every other spec in this directory carries
either a completed review or an explicit waiver.

## As shipped — additions beyond this spec

Built directly from live user feedback after the plan's 8 tasks landed, not
from a revised spec (same single-cycle, direct-iteration mode as the rest of
this phase):

- **Finish from any step, Profile included.** Every step past Profile already
  offers a Finish button alongside Next (§"Alternatives considered" never
  anticipated a per-step shortcut, only the implicit "close the dialog" exit).
  Profile itself gained a second, outline Finish button next to its submit
  button once a later step exists, so a user can create the student and stop
  without visiting Guardians first.
- **Back and the step tabs reach every step, Profile included.** The plan's
  "Back never returns to Profile" rule (Global Constraints) is superseded:
  Profile now re-renders locked (every field disabled via a wrapping
  `<fieldset>`) once the student exists, so revisiting it can only review,
  never resubmit and create a duplicate. A `maxStepReached` high-water mark
  (not just the current step) tracks what the stepper's own tab row will
  let a click jump straight to.
- **Edit absorbed into the same stepper.** `StudentCreateStepper` and
  `StudentCreateProfileStep` take an optional `mode`/`studentId`/
  `initialStepKey`: in `"edit"` mode the wizard opens on an already-real
  student (fetched directly), every step is reachable immediately — no
  progress gating — and Profile saves via `updateStudent` instead of
  `createStudent`, never locking against resubmission the way create mode
  does. The detail sheet's Edit button opens it landed on whichever tab was
  showing; the directory row's own Edit action has no tab context, so it
  always lands on Profile. `StudentFormDialog` — the single-page dialog this
  spec's Context section describes as the status quo — is deleted entirely,
  both call sites (create and edit) now going through the stepper.
