"""Seed the tenants and admin the e2e `live` lane's E2E_LIVE_* defaults expect.

Idempotent — safe to run on every ``seed-dev.sh`` invocation and every CI run of
the e2e-live workflow. Never runs against anything but a local/CI dev database:
it hardcodes dummy credentials that must never reach staging or production. Kept
alongside ``seed_dev_data`` (same app, same imports) rather than under
``apps.school_organization``, even though most of the data it creates lives
there, so both seed commands stay discoverable together.

Password comes from ``E2E_LIVE_ADMIN_PASSWORD`` so it can never drift from
``e2e/src/env.ts``'s zod default, which reads the same env var.
"""

import os
import uuid
from datetime import time, timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.academics.models import TeacherSubjectAllocation
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Section,
    SessionStatus,
    Subject,
    Term,
)
from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from apps.student_management.models import Gender, Student
from apps.timetable.models import (
    Period,
    Room,
    RoomType,
    SlotStatus,
    SubstitutionStatus,
    TeacherSubstitution,
    TimetableSlot,
)
from core.rbac.models import RecordScope
from core.rbac.seeding import (
    ensure_role_with_permissions,
    ensure_school_owner_role,
    ensure_seed_user,
    ensure_tenant,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride, TenantSettings

E2E_TENANT_SLUG = "e2e-school"
E2E_OTHER_TENANT_SLUG = "e2e-other-school"
E2E_ADMIN_EMAIL = "e2e-admin@schoolhub.test"
# A distinct email, not the same one disambiguated by `school`: the dashboard's login
# form never sends `school` (it derives it from the subdomain, and the dashboard itself
# has no tenant subdomain — see apps/dashboard/src/features/auth/login-form.tsx), so two
# accounts sharing one email across tenants make every browser-driven live-lane login
# genuinely ambiguous, not just theoretically. Confirmed against the real API, not assumed.
E2E_OTHER_ADMIN_EMAIL = "e2e-admin-other@schoolhub.test"
# Dev/CI-only seed data, matches e2e/src/env.ts's own fallback. `or`, not
# `.get(key, default)`: an unset CI secret still sets the env var to an empty
# string via `-e VAR` in the workflow, which `.get` would happily return.
E2E_ADMIN_PASSWORD = os.environ.get("E2E_LIVE_ADMIN_PASSWORD") or "e2e-not-a-real-password"  # noqa: S105

E2E_CAMPUS_CODE = "MAIN"
E2E_CLASS_NAME = "Grade 1"
E2E_SECTION_NAME = "A"
E2E_SESSION_NAME = "E2E Baseline"

# Academics baseline (academics.md §5.1/§5.3): one subject, one curriculum row mapping it
# to the baseline class for the baseline session, and one active *teaching* staff member.
# A teacher allocation is only creatable where all three already exist —
# `services.assert_subject_in_class_curriculum` refuses a subject that is not in the
# section's class curriculum, and `assert_staff_is_active_teacher` refuses anyone who is
# not active teaching staff — so an allocation spec with no seeded curriculum/teacher can
# only ever assert its own setup, never the module's rules.
E2E_SUBJECT_NAME = "E2E Mathematics"
E2E_SUBJECT_CODE = "E2E-MATH"
E2E_TEACHER_EMPLOYEE_NUMBER = "E2E-TEACHER-1"
E2E_TEACHER_NAME = ("E2E", "Teacher")

# Timetable baseline — timetable.md §5.1 (bell schedule), §5.2 (the weekly grid),
# §5.4 (rooms) and §7.2 (substitutions).
#
# A *second* teaching staff member exists only for the substitution: §11 refuses a
# substitute who is the absentee, and the check constraint
# `substitutions_substitute_differs_from_absentee` refuses it again at the database.
# One seeded teacher can therefore only ever demonstrate the refusal, never a real
# proposal — the same reason the academics lane needed a second *identity* to prove
# an approval rather than only bounce off it.
E2E_SUBSTITUTE_EMPLOYEE_NUMBER = "E2E-TEACHER-2"
E2E_SUBSTITUTE_NAME = ("E2E", "Substitute")

# The bell schedule is seeded **tenant-wide** (`campus=None`, which Period's own help
# text defines as "every campus") rather than pinned to the seeded campus, and that is
# load-bearing rather than a shortcut: `period_wrong_campus` is a *hard* conflict
# whenever a slot's period names a campus its section is not on, so a campus-pinned
# schedule would make every live spec that builds a grid on its own run-unique campus
# fail on a rule it is not testing.
#
# The flip side, which a spec author has to know: `assert_period_does_not_overlap`
# compares a new period against the campus's own rows *and* the tenant-wide ones, so
# these five occupy 08:00-11:20 for every campus in this tenant. A spec creating its
# own periods picks a window clear of that (see e2e/tests/live/api/timetable.spec.ts).
#
# (name, sequence, start, end, is_break, weekdays)
E2E_PERIODS = (
    ("Period 1", 1, time(8, 0), time(8, 45), False, None),
    ("Period 2", 2, time(8, 45), time(9, 30), False, None),
    ("Recess", 3, time(9, 30), time(9, 50), True, None),
    ("Period 3", 4, time(9, 50), time(10, 35), False, None),
    # §5.1's per-weekday day templates — a short Friday. This is the only fixture that
    # makes `Period.weekdays` *read* rather than merely written: `period_not_on_weekday`
    # is hard, so the seeded grid deliberately leaves this period empty on Fridays and a
    # grid screen renders it as "not scheduled" there.
    ("Period 4", 5, time(10, 35), time(11, 20), False, [0, 1, 2, 3]),
)

# (code, name, room_type, capacity). Capacities sit comfortably above the seeded
# section's roll (no baseline enrollments exist), so `room_over_capacity` — the one
# soft finding these rooms could produce — stays quiet.
E2E_ROOMS = (
    ("R-101", "Room 101", RoomType.CLASSROOM, 35),
    ("LAB-1", "Science Lab", RoomType.LAB, 30),
    ("HALL", "Assembly Hall", RoomType.AUDITORIUM, 200),
)

# The published week for the seeded section, as (day_of_week, period sequence) cells.
# 0-4 is Monday-Friday; `day_of_week` and `date.weekday()` coincide while every seeded
# tenant starts its week on Monday (services._slot_weekday says the same).
#
# The shape is dictated by the conflict engine, not by taste. There is exactly one
# seeded subject, and `subject_repeated_in_day` warns above one occurrence of a subject
# per section per day — so the taught period runs once a day across five days rather
# than twice on any one of them. The other two blocks carry no subject at all (a
# homeroom and an assembly, which models.TimetableSlot's nullable `subject`/`staff`
# exist for), which is also what keeps them clear of `teacher_not_allocated`: that
# detector only fires when a slot has both a teacher and a subject.
E2E_GRID_WEEKDAYS = (0, 1, 2, 3, 4)
E2E_TAUGHT_PERIOD_SEQUENCE = 1
E2E_HOMEROOM_PERIOD_SEQUENCE = 4
E2E_ASSEMBLY_PERIOD_SEQUENCE = 5

# Role-based CUJ identities (student-management). `school_owner` holds every permission,
# which can't prove a narrower role/scope actually gates anything — these two exist so a
# live spec can log in as a real, minimally-privileged identity instead.
#
# `school_admin`, not `admission_staff`: confirmed against the real API that the
# admission->enrollment journey's emergency-contact step needs `students.student.update`
# (apps/student_management/views.py's EmergencyContactViewSet reuses that key, not a
# distinct one), which RECORD_MANAGERS grants to `school_admin` only — `admission_staff`
# holds `students.student.create`/`.view` but genuinely cannot complete this journey
# alone per the shipped permission model. A single `school_admin` doing the whole
# admission->enrollment flow is the more realistic single-actor journey, not a
# simplification of it.
#
# `principal` is the second half of the academics promotion journey and exists for one
# reason the first identity cannot cover: academics.md §7.2 / auth-and-rbac.md §2.4 say
# the approver may not be the preparer, and `services.approve_batch` enforces it against
# the rows' own `created_by`. Proving that rule needs two *real* identities — a single
# all-permissions admin can only ever prove the refusal, never the successful approval.
E2E_SCHOOL_ADMIN_EMAIL = "e2e-school-admin@schoolhub.test"
E2E_PRINCIPAL_EMAIL = "e2e-principal@schoolhub.test"
E2E_STUDENT_EMAIL = "e2e-student@schoolhub.test"
# The exact keys apps/student_management/permissions.py grants `school_admin` for this
# journey — not the full registry. Plus the school_organization *.view keys `school_admin`
# also holds via ALL_STAFF there (apps/school_organization/permissions.py) — confirmed
# needed against the real API: the create-student form's Campus select and the Enroll
# dialog's session/class/section selects all call GET on these, and 403 without them, not
# just render empty.
E2E_SCHOOL_ADMIN_PERMISSIONS = [
    "students.student.view",
    "students.student.create",
    "students.student.update",
    "students.enrollment.enroll",
    "students.guardian.view",
    "students.guardian.create",
    "students.document.view",
    "students.document.create",
    "school.campus.view",
    "school.house.view",
    "school.academic-session.view",
    "school.class.view",
    "school.section.view",
    # Academics (apps/academics/permissions.py) — exactly the keys that file grants
    # `school_admin`, no more: CURRICULUM_MANAGERS and ALLOCATION_MANAGERS both include
    # it, PROMOTION_PREPARERS gives it create/update, and `execute` is `school_admin`-only
    # by §4. Deliberately NOT `academics.promotion.approve` (PROMOTION_APPROVERS is
    # `principal`/`school_owner`): granting it here would let this identity approve its own
    # batch and quietly turn the segregation-of-duties journey into a single-actor one.
    "academics.curriculum.view",
    "academics.curriculum.create",
    "academics.curriculum.update",
    "academics.curriculum.delete",
    "academics.teacher-allocation.view",
    "academics.teacher-allocation.create",
    "academics.teacher-allocation.update",
    "academics.teacher-allocation.delete",
    "academics.promotion.view",
    "academics.promotion.create",
    "academics.promotion.update",
    "academics.promotion.execute",
    # Timetable (apps/timetable/permissions.py) — again exactly the keys that file grants
    # `school_admin`, and no more. It is in BUILDERS (the four slot keys), GRID_ADMINS
    # (period and room writes) and PUBLISHERS (`timetable.timetable.publish`), and
    # `timetable.timetable.view` is the key §4 reuses for reading the scaffolding —
    # `/periods` and `/rooms` declare no view key of their own (views.py's header).
    #
    # Deliberately NOT `timetable.substitution.approve`: SUBSTITUTION_APPROVERS is
    # `vice_principal`/`principal`, so granting it here would let the proposer confirm
    # their own cover — the same segregation-of-duties point as promotion.approve above.
    # Deliberately NOT `timetable.timetable.export` either: no endpoint reads that key
    # yet, and this list is the keys a journey needs, not the registry.
    "timetable.timetable.view",
    "timetable.timetable.publish",
    "timetable.slot.view",
    "timetable.slot.create",
    "timetable.slot.update",
    "timetable.slot.delete",
    "timetable.period.create",
    "timetable.period.update",
    "timetable.period.delete",
    "timetable.room.create",
    "timetable.room.update",
    "timetable.room.delete",
    "timetable.substitution.create",
    # The curriculum editor's Subject select and the allocation grid's Teacher select are
    # plain `GET /subjects` / `GET /staff` calls, each behind its own module's view key —
    # same reason the school_organization *.view keys above are here rather than assumed.
    # The week grid's Subject and Teacher selects are the same two calls.
    "school.subject.view",
    "staff.staff.view",
]
# The approver half of §7.2. `principal` holds `academics.promotion.approve` (and, per §4,
# does NOT hold `.execute` — execution is `school_admin`'s), plus the read keys the review
# screen needs to render a batch at all: the decision rows carry ids, so names come from
# `GET /students`, and the batch header from the session/class endpoints.
E2E_PRINCIPAL_PERMISSIONS = [
    "academics.promotion.view",
    "academics.promotion.approve",
    "academics.curriculum.view",
    "academics.teacher-allocation.view",
    "students.student.view",
    "school.campus.view",
    "school.academic-session.view",
    "school.class.view",
    "school.section.view",
]
# The one key restricted principals (student, guardian) may hold at all — auth-and-rbac.md
# §6 rule 4 — scope-narrowed via RecordScope.OWN rather than the grant itself being unsafe.
E2E_STUDENT_PERMISSIONS = ["students.student.view"]

E2E_STUDENT_A_NAME = ("E2E", "Student A")
E2E_STUDENT_B_NAME = ("E2E", "Student B")


class Command(BaseCommand):
    help = (
        "Seed the two tenants and the admin the e2e `live` lane's E2E_LIVE_* env "
        "defaults expect, plus enough baseline school_organization data for the "
        "academic-session activation journey to pass its completeness check, the "
        "academics fixtures (subject, curriculum row, teaching staff, principal "
        "approver) the curriculum/allocation/promotion specs need, and the timetable "
        "fixtures (bell schedule, rooms, a published week and one proposed "
        "substitution) the grid and substitution specs need."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = ensure_tenant(E2E_TENANT_SLUG, "E2E School")
        other_tenant = ensure_tenant(E2E_OTHER_TENANT_SLUG, "E2E Other School")

        role = ensure_school_owner_role()
        ensure_seed_user(
            tenant,
            role,
            email=E2E_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Admin",
        )
        # A distinct email (not the same one disambiguated by `school`) — lets a live spec
        # log in as a real admin of the *other* tenant to prove cross-tenant isolation
        # against a real second identity, not just a placeholder id under the first
        # tenant's own session.
        ensure_seed_user(
            other_tenant,
            role,
            email=E2E_OTHER_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Admin",
        )

        school_admin_role = ensure_role_with_permissions(
            tenant, "school_admin", "School Admin", E2E_SCHOOL_ADMIN_PERMISSIONS
        )
        ensure_seed_user(
            tenant,
            school_admin_role,
            email=E2E_SCHOOL_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="School Admin",
        )
        principal_role = ensure_role_with_permissions(
            tenant, "principal", "Principal", E2E_PRINCIPAL_PERMISSIONS
        )
        ensure_seed_user(
            tenant,
            principal_role,
            email=E2E_PRINCIPAL_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Principal",
        )
        student_role = ensure_role_with_permissions(
            tenant, "student", "Student", E2E_STUDENT_PERMISSIONS, is_restricted_principal=True
        )
        student_user = ensure_seed_user(
            tenant,
            student_role,
            email=E2E_STUDENT_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Student",
            scope=RecordScope.OWN,
        )

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)
            campus = self._ensure_campus(tenant)
            school_class, section = self._ensure_class_and_section(tenant, campus)
            session = self._ensure_baseline_session(tenant)
            self._ensure_students_module_enabled(tenant)
            self._ensure_students(tenant, campus, student_user_id=student_user.id)
            self._ensure_academics_enabled(tenant)
            self._ensure_staff_module_enabled(tenant)
            subject = self._ensure_subject(tenant)
            self._ensure_curriculum(
                tenant, session=session, school_class=school_class, subject=subject
            )
            teacher = self._ensure_teaching_staff(
                tenant,
                campus,
                employee_number=E2E_TEACHER_EMPLOYEE_NUMBER,
                name=E2E_TEACHER_NAME,
                phone="+15550000001",
            )
            substitute = self._ensure_teaching_staff(
                tenant,
                campus,
                employee_number=E2E_SUBSTITUTE_EMPLOYEE_NUMBER,
                name=E2E_SUBSTITUTE_NAME,
                phone="+15550000002",
            )

            # Timetable. Ordered by dependency, and the allocation is not optional
            # bookkeeping: `conflicts._unallocated_teachers` is a *hard* finding, so a
            # seeded grid whose teacher holds no allocation would report
            # `teacher_not_allocated` on every taught cell and refuse to publish — a
            # fixture that can only ever assert its own broken setup.
            self._ensure_timetable_enabled(tenant)
            periods = self._ensure_periods(tenant)
            rooms = self._ensure_rooms(tenant, campus)
            self._ensure_teacher_allocation(
                tenant, session=session, section=section, subject=subject, teacher=teacher
            )
            slots = self._ensure_timetable_slots(
                tenant,
                session=session,
                section=section,
                subject=subject,
                teacher=teacher,
                periods=periods,
                rooms=rooms,
            )
            self._ensure_substitution(
                tenant, slots=slots, absent_staff=teacher, substitute_staff=substitute
            )

        # The *other* tenant needs the academics flag too, and for a reason easy to get
        # backwards: `TenantScopedViewSetMixin` checks `required_feature` *before*
        # `required_permission` (apps/academics/views.py's header), so a cross-tenant probe
        # against a tenant with the module off answers 403 `module_disabled` — never
        # reaching the row lookup that is what the isolation specs actually assert. A
        # 404-vs-403 spec run against a flag-disabled second tenant would pass or fail for
        # a reason that has nothing to do with RLS.
        with tenant_context(other_tenant.id):
            self._ensure_academics_enabled(other_tenant)
            # Same reasoning, one module along: `module.timetable` also defaults off, so
            # a cross-tenant probe against a room, period, slot or substitution would be
            # answered 403 `module_disabled` by the feature gate before it ever reached
            # the row lookup that is what an isolation spec actually asserts.
            self._ensure_timetable_enabled(other_tenant)

        # TODO(website-cms): no public-content/CMS backend module exists yet
        # (apps/api/config/api_v1.py routes only core.rbac and
        # apps.school_organization) — there is nothing here to seed real tenant
        # website content into. e2e/tests/live/website-tenant-resolution.spec.ts
        # pins the real current (degraded) behavior instead; revisit this seed
        # once that module ships.

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded tenant '{tenant.slug}' with admin {E2E_ADMIN_EMAIL}, school admin "
                f"{E2E_SCHOOL_ADMIN_EMAIL}, principal {E2E_PRINCIPAL_EMAIL}, and student "
                f"{E2E_STUDENT_EMAIL}; tenant '{E2E_OTHER_TENANT_SLUG}' with admin "
                f"{E2E_OTHER_ADMIN_EMAIL}"
            )
        )

    def _ensure_students_module_enabled(self, tenant: Tenant) -> None:
        """`module.students` defaults off (features.py) — every endpoint 403s with
        `module_disabled` until a tenant is explicitly onboarded onto it, same recipe
        `apps/student_management/tests/factories.py::enable_feature` uses.

        `update_or_create`, not `get_or_create`: a prior run (or someone poking at the
        override in the admin) could have left this row `enabled=False`, and
        `get_or_create` only sets `defaults` on *creation* — it would leave an existing,
        disabled row disabled forever, silently reintroducing the very `module_disabled`
        403s this seed step exists to prevent.
        """
        flag = FeatureFlag.objects.get(key="module.students")
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "e2e live-lane fixture"},
        )

    def _ensure_academics_enabled(self, tenant: Tenant) -> None:
        """`module.academics` defaults off (apps/academics/features.py).

        Same `update_or_create`-not-`get_or_create` reasoning as
        `_ensure_students_module_enabled` above — an existing `enabled=False` row would
        survive a re-seed and 403 every academics endpoint with `module_disabled`.

        Called for *both* tenants (see `handle`): the second one needs the module on for
        a cross-tenant probe to reach the row lookup and answer 404 rather than being
        turned away by the feature gate first.
        """
        flag = FeatureFlag.objects.get(key="module.academics")
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "e2e live-lane fixture"},
        )

    def _ensure_timetable_enabled(self, tenant: Tenant) -> None:
        """`module.timetable` defaults off (apps/timetable/features.py).

        Same `update_or_create`-not-`get_or_create` reasoning as
        `_ensure_students_module_enabled` above. Called for *both* tenants (see
        `handle`) for the same reason `module.academics` is.
        """
        flag = FeatureFlag.objects.get(key="module.timetable")
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "e2e live-lane fixture"},
        )

    def _ensure_staff_module_enabled(self, tenant: Tenant) -> None:
        """`module.staff` defaults off, and the academics lane needs it on.

        Not because any academics endpoint checks it — they check `module.academics` —
        but because the *only* way to discover the seeded teacher's id is
        `GET /staff?search=…`, which is behind `module.staff`. The allocation grid's
        teacher picker is the same call. Without this flag the seeded staff row exists
        but nothing can look it up, which is indistinguishable from not seeding it.
        """
        flag = FeatureFlag.objects.get(key="module.staff")
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "e2e live-lane fixture"},
        )

    def _ensure_subject(self, tenant: Tenant) -> Subject:
        subject, _ = Subject.objects.get_or_create(
            tenant=tenant,
            code=E2E_SUBJECT_CODE,
            defaults={"name": E2E_SUBJECT_NAME, "is_active": True},
        )
        return subject

    def _ensure_curriculum(
        self, tenant: Tenant, *, session: AcademicSession, school_class: Class, subject: Subject
    ) -> ClassSubject:
        """One `class_subjects` row: the baseline class studies the baseline subject.

        `campus=None` on purpose — "applies to every campus" (the model's own help text),
        which is what the unique constraint's `nulls_distinct=False` is there to make
        idempotent. Written through the ORM rather than
        `school_organization.services.map_subject_to_class`: the service is the API's
        path and re-raises a `Conflict` on a duplicate, which would make a second
        `seed_e2e_data` run fail rather than converge.
        """
        curriculum, _ = ClassSubject.objects.get_or_create(
            tenant=tenant,
            academic_session=session,
            school_class=school_class,
            subject=subject,
            campus=None,
            defaults={"weekly_periods": 4, "is_elective": False},
        )
        return curriculum

    def _ensure_teaching_staff(
        self,
        tenant: Tenant,
        campus: Campus,
        *,
        employee_number: str,
        name: tuple[str, str],
        phone: str,
    ) -> Staff:
        """One active teaching staff member — `assert_staff_is_active_teacher` (§11)
        refuses anyone who is not both, so a non-teaching or exited fixture would make
        every allocation spec fail for a reason unrelated to what it is testing.

        Parameterised rather than hardcoded because the timetable lane needs a *second*
        one: a substitution's substitute may not be its absentee (§11, and the
        `substitutions_substitute_differs_from_absentee` check constraint behind it), so
        a single teacher cannot stand on both sides of one.

        Created through the ORM with an explicit `employee_number` rather than through
        `staff_management.services.create_staff`, which allocates one from the tenant's
        numbering pattern via `TenantCounter` — a fresh number every run, so the row
        could not be looked up again and re-seeding would pile up staff. The explicit
        number is the idempotency key, exactly as `admission_number` is for the seeded
        students.

        No `user_id` link: nothing here needs a teacher to *log in* yet. A `teacher`-role
        identity at `RecordScope.OWN` (which `TeacherSubjectAllocation.filter_owned_by_user`
        resolves through `staff.user_id`) is the natural next fixture when a spec proves
        "a teacher sees only their own allocations".
        """
        staff, _ = Staff.objects.get_or_create(
            tenant=tenant,
            employee_number=employee_number,
            defaults={
                "first_name": name[0],
                "last_name": name[1],
                "staff_type": StaffType.TEACHING,
                "employment_status": EmploymentStatus.ACTIVE,
                "campus": campus,
                "joining_date": "2026-01-01",
                "phone": phone,
            },
        )
        return staff

    def _ensure_students(
        self, tenant: Tenant, campus: Campus, *, student_user_id: uuid.UUID
    ) -> None:
        """Two baseline students for the record-scope CUJ: "A" is what the seeded
        `student`-role user (`user_id=student_user_id`) must be able to see via
        `RecordScope.OWN`; "B" has no linked user and is what that same user must get a
        404 on — proving the scope filters, not just the permission key.
        """
        self._ensure_baseline_student(
            tenant,
            campus,
            admission_number="E2E-STUDENT-A",
            name=E2E_STUDENT_A_NAME,
            date_of_birth="2015-06-01",
            user_id=student_user_id,
        )
        self._ensure_baseline_student(
            tenant,
            campus,
            admission_number="E2E-STUDENT-B",
            name=E2E_STUDENT_B_NAME,
            date_of_birth="2016-06-01",
        )

    def _ensure_baseline_student(
        self,
        tenant: Tenant,
        campus: Campus,
        *,
        admission_number: str,
        name: tuple[str, str],
        date_of_birth: str,
        user_id: uuid.UUID | None = None,
    ) -> None:
        # `user_id`, not `admission_number`, is the lookup key when linking a student to a
        # real user: `Student.user_id` is unique, so a second run with the same
        # `student_user_id` must find "A" by that link rather than by name/admission
        # number, which `get_or_create`'s `defaults` would otherwise let drift.
        lookup: dict[str, object] = (
            {"tenant": tenant, "user_id": user_id}
            if user_id
            else {"tenant": tenant, "admission_number": admission_number}
        )
        Student.objects.get_or_create(
            **lookup,
            defaults={
                "admission_number": admission_number,
                "first_name": name[0],
                "last_name": name[1],
                "date_of_birth": date_of_birth,
                "gender": Gender.UNSPECIFIED,
                "campus": campus,
                "admission_date": "2026-01-01",
            },
        )

    def _ensure_campus(self, tenant: Tenant) -> Campus:
        campus, _ = Campus.objects.get_or_create(
            tenant=tenant,
            code=E2E_CAMPUS_CODE,
            defaults={"name": "Main Campus", "is_primary": True, "is_active": True},
        )
        return campus

    def _ensure_class_and_section(self, tenant: Tenant, campus: Campus) -> tuple[Class, Section]:
        """Returns both: the academics curriculum row maps a subject *to* the class,
        while every timetable row below hangs off the section — a slot's cell is
        (session, section, weekday, period), and a teacher allocation is section-scoped
        too."""
        school_class, _ = Class.objects.get_or_create(
            tenant=tenant,
            name=E2E_CLASS_NAME,
            defaults={"level": 1, "is_active": True},
        )
        section, _ = Section.objects.get_or_create(
            tenant=tenant,
            school_class=school_class,
            campus=campus,
            name=E2E_SECTION_NAME,
            defaults={"capacity": 30, "is_active": True},
        )
        return school_class, section

    def _ensure_baseline_session(self, tenant: Tenant) -> AcademicSession:
        """Returns the session — the curriculum row is session-scoped, so the academics
        builders need the row this step either found or created, not just the fact that
        one exists."""
        existing = AcademicSession.objects.filter(tenant=tenant, name=E2E_SESSION_NAME).first()
        if existing is not None:
            return existing

        today = timezone.now().date()
        start_date = today - timedelta(days=30)
        end_date = start_date + timedelta(days=364)

        session = AcademicSession.objects.create(
            tenant=tenant,
            name=E2E_SESSION_NAME,
            start_date=start_date,
            end_date=end_date,
            status=SessionStatus.ACTIVE,
            is_current=True,
        )
        Term.objects.create(
            tenant=tenant,
            academic_session=session,
            name="Full Year",
            sequence=1,
            start_date=start_date,
            end_date=end_date,
        )
        return session

    # ------------------------------------------------------------------
    # Timetable (docs/03-modules/timetable.md)
    # ------------------------------------------------------------------

    def _ensure_periods(self, tenant: Tenant) -> dict[int, Period]:
        """The bell schedule, keyed by `sequence`.

        Keyed by sequence rather than returned as a list because every builder below
        names a cell by the period it runs in ("the taught period", "the assembly
        period"); ids are generated per seed run and would have to be looked back up.

        Written through the ORM rather than through `PeriodSerializer`, whose
        `validate` calls `assert_period_does_not_overlap` and would raise on the second
        run — the same reason `_ensure_curriculum` bypasses `map_subject_to_class`.
        Keeping the rows in `E2E_PERIODS` non-overlapping is this fixture's own job in
        exchange.

        `campus=None` is part of the *lookup*, not merely a default:
        `periods_unique_sequence_per_campus` is declared `nulls_distinct=False`
        precisely so a tenant-wide sequence is unique, which is what makes finding the
        row again on a re-run work at all.
        """
        periods: dict[int, Period] = {}
        for name, sequence, start_time, end_time, is_break, weekdays in E2E_PERIODS:
            period, _ = Period.objects.get_or_create(
                tenant=tenant,
                campus=None,
                sequence=sequence,
                defaults={
                    "name": name,
                    "start_time": start_time,
                    "end_time": end_time,
                    "is_break": is_break,
                    "weekdays": weekdays,
                },
            )
            periods[sequence] = period
        return periods

    def _ensure_rooms(self, tenant: Tenant, campus: Campus) -> dict[str, Room]:
        """Rooms on the seeded campus, keyed by code.

        `rooms_unique_code_per_campus` makes (campus, code) the natural idempotency
        key here, exactly as `code` is for a campus and `admission_number` is for a
        student. Rooms are campus-bound by the model (`campus` is non-null), so unlike
        the bell schedule above there is no tenant-wide option to weigh.
        """
        rooms: dict[str, Room] = {}
        for code, name, room_type, capacity in E2E_ROOMS:
            room, _ = Room.objects.get_or_create(
                tenant=tenant,
                campus=campus,
                code=code,
                defaults={
                    "name": name,
                    "room_type": room_type,
                    "capacity": capacity,
                    "is_active": True,
                },
            )
            rooms[code] = room
        return rooms

    def _ensure_teacher_allocation(
        self,
        tenant: Tenant,
        *,
        session: AcademicSession,
        section: Section,
        subject: Subject,
        teacher: Staff,
    ) -> TeacherSubjectAllocation:
        """The academics row that makes the seeded grid publishable at all.

        `conflicts._unallocated_teachers` is *hard*: a teacher scheduled for a subject
        they hold no allocation for is the timetable contradicting academics, so
        without this row every taught cell below reports `teacher_not_allocated` and
        `:publish` refuses with a 422.

        Written through the ORM rather than `academics.services.create_allocation` for
        the same reason as `_ensure_curriculum`: the service is the API's path and
        raises on a duplicate, which would make a second run fail rather than converge.
        """
        allocation, _ = TeacherSubjectAllocation.objects.get_or_create(
            tenant=tenant,
            academic_session=session,
            section=section,
            subject=subject,
            staff=teacher,
            defaults={"is_primary": True, "effective_from": session.start_date},
        )
        return allocation

    def _ensure_timetable_slots(
        self,
        tenant: Tenant,
        *,
        session: AcademicSession,
        section: Section,
        subject: Subject,
        teacher: Staff,
        periods: dict[int, Period],
        rooms: dict[str, Room],
    ) -> dict[tuple[int, int], TimetableSlot]:
        """A *published* week for the seeded section, keyed by (weekday, sequence).

        Published rather than draft because that is the state anything downstream can
        actually read: `GET /timetables/my` serves published rows exclusively (§5.7),
        and a substitution may only cover a published slot. The rows are written
        already-published rather than by calling `publish_section_timetable`, which
        supersedes the current version and would end-date this same grid on every
        re-seed.

        `effective_from` is the session's start, not today: it is the day this version
        came into force, and `slot_version_window` reads it back when a past date is
        asked for. Leaving it null would work too — the window treats null as "has
        always been in force" — but a grid that claims to predate its own session is a
        confusing thing to hand a spec.

        The three published-row unique indexes are what the layout is shaped around:
        one slot per (section, weekday, period), and neither the teacher nor a room
        twice in one cell.
        """
        classroom = rooms["R-101"]
        hall = rooms["HALL"]
        assembly_period = periods[E2E_ASSEMBLY_PERIOD_SEQUENCE]

        # Derived from the seeded period's own `weekdays` rather than restated: these
        # two disagreeing is exactly the `period_not_on_weekday` hard conflict, and a
        # fixture that can drift into it would fail for a reason unrelated to any spec.
        assembly_weekdays = tuple(
            day
            for day in E2E_GRID_WEEKDAYS
            if not assembly_period.weekdays or day in assembly_period.weekdays
        )

        plan: list[tuple[int, int, dict]] = []
        for day in E2E_GRID_WEEKDAYS:
            plan.append(
                (
                    day,
                    E2E_TAUGHT_PERIOD_SEQUENCE,
                    {"subject": subject, "staff": teacher, "room": classroom, "notes": None},
                )
            )
            plan.append(
                (
                    day,
                    E2E_HOMEROOM_PERIOD_SEQUENCE,
                    {"subject": None, "staff": teacher, "room": classroom, "notes": "Homeroom"},
                )
            )
        for day in assembly_weekdays:
            plan.append(
                (
                    day,
                    E2E_ASSEMBLY_PERIOD_SEQUENCE,
                    {"subject": None, "staff": None, "room": hall, "notes": "Assembly"},
                )
            )

        slots: dict[tuple[int, int], TimetableSlot] = {}
        for day, sequence, cell in plan:
            slot, _ = TimetableSlot.objects.get_or_create(
                tenant=tenant,
                academic_session=session,
                section=section,
                day_of_week=day,
                period=periods[sequence],
                defaults={
                    "subject": cell["subject"],
                    "staff": cell["staff"],
                    "room": cell["room"],
                    "notes": cell["notes"],
                    "status": SlotStatus.PUBLISHED,
                    "effective_from": session.start_date,
                },
            )
            slots[(day, sequence)] = slot
        return slots

    def _ensure_substitution(
        self,
        tenant: Tenant,
        *,
        slots: dict[tuple[int, int], TimetableSlot],
        absent_staff: Staff,
        substitute_staff: Staff,
    ) -> None:
        """One §7.2 proposal, left undecided.

        `proposed` on purpose: `decide_substitution` refuses anything that is not, so a
        pre-confirmed fixture could only ever demonstrate the 409 — a spec that wants
        to walk `:approve` or `:reject` forward needs a row still waiting for a
        decision. There is exactly one, and a spec that decides it has consumed it, so
        anything that needs a second proposal builds its own through the API.

        Looked up by *slot* rather than by (slot, date), which is what the unique
        constraint actually is: the date below moves with the calendar, so keying on it
        would quietly pile up one more proposal for every day the seed is re-run.
        """
        slot = slots[(0, E2E_TAUGHT_PERIOD_SEQUENCE)]
        if TeacherSubstitution.objects.alive().filter(timetable_slot=slot).exists():
            return

        # The next Monday after today. §11 requires the date to fall on the slot's own
        # weekday and inside the session: `day_of_week` 0 and `date.weekday()` 0 are
        # both Monday while every seeded tenant starts its week there (see
        # `services._slot_weekday`), and a week out is comfortably inside a session
        # that runs from thirty days ago for a year.
        today = timezone.now().date()
        TeacherSubstitution.objects.create(
            tenant=tenant,
            timetable_slot=slot,
            date=today + timedelta(days=(7 - today.weekday()) % 7 or 7),
            absent_staff=absent_staff,
            substitute_staff=substitute_staff,
            reason="e2e live-lane fixture",
            status=SubstitutionStatus.PROPOSED,
        )
