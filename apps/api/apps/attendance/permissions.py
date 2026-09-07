"""Permission keys for the attendance module — docs/03-modules/attendance.md §4.

Mirrors that table exactly. Two things about it are worth stating once:

- **`mark` is this module's declared verb** (§4's own header says so). It is
  already in ``core.rbac.registry.EXTRA_ACTIONS``, registered there by an earlier
  module doc pass, so no registry change ships with this app.
- **`attendance.student-attendance.import` is declared in §9, not §4.** The
  module doc names the key and the role in prose — "granted to `it_admin` during
  migration (recommendation)" — while §4's permission table omits the row. The
  key is registered here and **the §4 table is updated in the same PR**, which is
  the direction AGENTS.md's "update the module doc in the same PR" points: a key
  the doc already names belongs in the table the doc keeps keys in. Inventing a
  key the doc never mentions would be the different, worse thing.
- **`student` and `guardian` hold real keys here**, unlike every module before
  this one, and that is what makes attendance the first module whose viewsets
  are not uniformly behind ``DenyRestrictedPrincipals``. §4 grants both an
  ``own``-scoped view of student attendance and the right to submit a leave
  request; the record scope, not the key, is what keeps a guardian to their own
  children (``StudentAttendance.filter_owned_by_user``).
"""

from core.rbac.registry import registry

# "All staff" in the §4 table means every default tenant role except the
# restricted principals (student, guardian), which never hold a staff key.
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

MARKERS = ("teacher", "class_teacher")
# §9 names this role explicitly — "granted to `it_admin` during migration" —
# and it is deliberately *not* the marking roles: a teacher marks today, an
# IT admin migrates a previous system's history once.
IMPORTERS = ("it_admin",)
LEADERSHIP = ("principal", "vice_principal", "school_admin")
STUDENT_ATTENDANCE_VIEWERS = (
    "teacher",
    "class_teacher",
    "principal",
    "vice_principal",
    "school_admin",
    "student",
    "guardian",
)
STAFF_ATTENDANCE_VIEWERS = (*ALL_STAFF,)
STAFF_ATTENDANCE_MARKERS = ("hr_staff", "school_admin")
CORRECTION_REQUESTERS = ("teacher", "class_teacher", "hr_staff")
LEAVE_REQUESTERS = ("student", "guardian")
LEAVE_APPROVERS = ("class_teacher", "vice_principal", "principal")
LEAVE_VIEWERS = ("class_teacher", "principal", "vice_principal", "school_admin")
REPORT_READERS = (
    "principal",
    "vice_principal",
    "school_admin",
    "hr_staff",
    "class_teacher",
)

registry.register(
    "attendance.student-attendance.view",
    "View student attendance (record-scoped: own, assigned, all).",
    STUDENT_ATTENDANCE_VIEWERS,
)
registry.register(
    "attendance.student-attendance.mark",
    "Mark or edit same-day student attendance.",
    MARKERS,
)

registry.register(
    "attendance.student-attendance.import",
    "Import a historical attendance register during tenant onboarding (§9).",
    IMPORTERS,
)

registry.register(
    "attendance.staff-attendance.view",
    "View staff attendance (own for every staff role; all for admin roles).",
    STAFF_ATTENDANCE_VIEWERS,
)
registry.register(
    "attendance.staff-attendance.mark",
    "Record staff check-in/out, late arrival and early departure.",
    STAFF_ATTENDANCE_MARKERS,
)

registry.register(
    "attendance.correction.create",
    "Request a correction to a locked attendance record.",
    CORRECTION_REQUESTERS,
)
registry.register(
    "attendance.correction.approve",
    "Approve or reject correction requests (never one's own — §11).",
    LEADERSHIP,
)

registry.register(
    "attendance.leave-request.create",
    "Submit a student leave request.",
    LEAVE_REQUESTERS,
)
registry.register(
    "attendance.leave-request.view",
    "View leave requests (record-scoped).",
    (*LEAVE_VIEWERS, *LEAVE_REQUESTERS),
)
registry.register(
    "attendance.leave-request.approve",
    "Approve or reject student leave (never one's own — §11).",
    LEAVE_APPROVERS,
)

registry.register("attendance.report.view", "Run attendance reports (§13).", REPORT_READERS)
registry.register("attendance.report.export", "Export attendance reports (§13).", REPORT_READERS)
