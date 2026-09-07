"""Permission keys for the examinations module — docs/03-modules/examinations.md §4.

Mirrors that table, with one class of exception worth stating plainly rather
than leaving a reader to notice.

**§4's table is missing rows for capabilities the doc grants elsewhere.** §3's
role table says a `student`/`guardian` "views admit cards, exam schedules,
published results, and report cards", and §12 sends both a schedule-published
and an admit-card-issued notification to them — but §4 has no `view` key for
either resource, so the capability was documented and unreachable. The same
holds for reading a grading scale (§5.5 computes every grade from one), for
reading a question bank (§13 reports on bank usage), and for *running* result
processing: §3 says `exam_staff` "runs result processing (not approval)" while
§4 lists only approve/publish/view/export.

This is the situation `attendance.student-attendance.import` already resolved:
the doc names the capability in prose, the table omits the key, and the fix is
to register the key **and add the §4 row in the same PR** — which is where
AGENTS.md's "update the module doc in the same PR" points. Inventing a key the
doc never mentions anywhere would be the different, worse thing.

The five added keys are `exams.grading-scale.view`, `exams.schedule.view`,
`exams.admit-card.view`, `exams.result.create` and `exams.question-bank.view`.

**No RBAC registry change ships with this module.** Every verb §4 declares is
already registered: `view/create/update/delete/export/import/approve/publish`
are `STANDARD_ACTIONS`, and §4's own module verbs `issue` and `lock` are in
`EXTRA_ACTIONS`. Result processing takes `create` rather than a new `process`
verb, and that is not a workaround — processing is precisely what creates
`results` rows, and `core/rbac/registry.py`'s comment asks that a new verb be
declared in a module doc §4 before being added, which `process` never was.

Keys arrive with the PR that ships an endpoint for them, so
`tests/test_endpoint_contracts.py` never sees a registered key with nothing
behind it. Registered so far: the exam and grading-scale keys (PR A), the
schedule and admit-card keys (PR B), and the marks keys (PR C).
"""

from core.rbac.registry import registry

# "All staff" means every default tenant role except the restricted principals
# (student, guardian), which never hold a staff key.
ALL_STAFF = (
    "school_owner",
    "school_admin",
    "principal",
    "vice_principal",
    "teacher",
    "class_teacher",
    "accountant",
    "finance_staff",
    "hr_staff",
    "reception",
    "admission_staff",
    "exam_staff",
    "librarian",
    "transport_manager",
    "transport_staff",
    "store_keeper",
    "it_admin",
)

EXAM_AUTHORS = ("exam_staff", "school_admin")
EXAM_VIEWERS = (
    "exam_staff",
    "school_admin",
    "principal",
    "vice_principal",
    "teacher",
    "class_teacher",
)
# §4 puts grading scales with the people who own school policy, not with the
# people who run an exam: a scale change silently regrades every result computed
# after it.
SCALE_AUTHORS = ("school_admin", "principal")

# §4 gives scheduling to `exam_staff` alone — it is the one operation in this
# module that books rooms and people, and a wider grant is how two departments
# double-book a hall.
SCHEDULERS = ("exam_staff",)
# The portal side of §3's role table. A `student`/`guardian` reads their own
# schedule and their own card; the *record scope*, not the key, is what narrows
# them (see each model's `filter_owned_by_user`).
PORTAL = ("student", "guardian")
# §4 gives marks entry to `teacher` and `exam_staff`. `teacher` is the load-
# bearing half and is narrowed further by *record scope*, not by the key: the
# `assigned` scope resolves through `academics.TeacherSubjectAllocation`, so a
# teacher reaches only the class-subjects they currently teach. Granting the key
# more widely and relying on the scope would be the same mistake as granting a
# portal role a staff key.
MARKS_ENTRANTS = ("teacher", "exam_staff")
# Locking closes a window and stamps every row, which is a school-policy act
# rather than a teaching one — §4 gives it to `exam_staff` and `school_admin`.
MARKS_LOCKERS = ("exam_staff", "school_admin")
ADMIT_CARD_VIEWERS = (
    "exam_staff",
    "school_admin",
    "principal",
    "vice_principal",
    "class_teacher",
    *PORTAL,
)

registry.register(
    "exams.exam.view",
    "View exam definitions and their subject configuration.",
    EXAM_VIEWERS,
)
registry.register("exams.exam.create", "Create an exam for a session or term.", EXAM_AUTHORS)
registry.register(
    "exams.exam.update",
    "Edit an exam's dates, weightage, grading scale or subject configuration.",
    EXAM_AUTHORS,
)
registry.register("exams.exam.delete", "Delete an exam that has not been marked.", EXAM_AUTHORS)

registry.register(
    "exams.grading-scale.view",
    "Read grading scales and their bands (§5.5 — every grade is computed from one).",
    ALL_STAFF,
)
registry.register(
    "exams.grading-scale.create",
    "Define a grading scale and its bands.",
    SCALE_AUTHORS,
)
registry.register(
    "exams.grading-scale.update",
    "Edit a grading scale or its bands.",
    SCALE_AUTHORS,
)

registry.register(
    "exams.schedule.view",
    "View exam schedules (record-scoped: own for portal users, assigned for teachers).",
    (*ALL_STAFF, *PORTAL),
)
registry.register(
    "exams.schedule.create",
    "Schedule a paper into a date, time, room and invigilator.",
    SCHEDULERS,
)
registry.register(
    "exams.schedule.update",
    "Reschedule, cancel or re-room a sitting; publish the schedule.",
    SCHEDULERS,
)

registry.register(
    "exams.admit-card.view",
    "View issued admit cards (record-scoped).",
    ADMIT_CARD_VIEWERS,
)
registry.register(
    "exams.admit-card.issue",
    "Generate, issue and revoke admit cards (§5.3).",
    ("exam_staff",),
)

registry.register(
    "exams.marks.create",
    "Enter marks for an assigned class-subject (§5.4).",
    MARKS_ENTRANTS,
)
registry.register(
    "exams.marks.update",
    "Edit marks already entered, while the window is open.",
    MARKS_ENTRANTS,
)
registry.register(
    "exams.marks.import",
    "Import a marks sheet (CSV or .xlsx) for one exam-subject.",
    ("exam_staff",),
)
registry.register(
    "exams.marks.lock",
    "Lock or reopen an exam-subject's marks window (§6 — audited).",
    MARKS_LOCKERS,
)
