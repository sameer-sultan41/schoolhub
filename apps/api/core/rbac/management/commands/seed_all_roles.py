"""Seed one login per canonical role, plus enough baseline data to browse.

`seed_dev_data` gives the "demo" tenant a single `school_owner` login and nothing
else; `seed_e2e_data` seeds a real school but only two students and two staff, and
only four of the roles the permission registry declares. Neither is meant to be a
dashboard demo account — both exist to serve automated tests, and a developer
opening the dashboard against either sees mostly empty screens and ends up
creating an account by hand for every role they want to look at.

This command targets the same "demo" tenant `seed_dev_data` creates and:

  - derives the role list from `core.rbac.registry` itself — every role named in
    any permission's `default_roles` — so it cannot drift from what the registry
    actually grants, and picks up new roles and new modules automatically as
    they ship (a module that is not installed contributes no keys, so this keeps
    working on a branch that has fewer of them);
  - creates one seed user per role holding exactly the permissions the registry
    says that role holds, through the same `ensure_role_with_permissions`
    machinery `seed_e2e_data` uses for its own role-based fixtures;
  - seeds a school worth looking at: a campus, two classes with two sections
    each, an academic session, three subjects mapped into the curriculum,
    teaching and non-teaching staff, 24 enrolled students, teacher allocations,
    and a published week for one section;
  - writes every login to `DEV_LOGINS.md` at the repository root (git-ignored),
    so a developer — or an agent driving the app — can look a role's credentials
    up instead of creating an account for each thing they want to test.

Idempotent, so re-running after a schema change or a partial seed converges
rather than duplicating. Like both commands it sits beside, it hardcodes dummy
credentials and must never be pointed at anything but a local dev database.
"""

from datetime import time, timedelta
from pathlib import Path

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
from apps.student_management.models import EnrollmentStatus, Gender, Student, StudentEnrollment
from apps.timetable.models import Period, Room, RoomType, SlotStatus, TimetableSlot
from core.rbac.management.commands.seed_dev_data import DEMO_TENANT_SLUG
from core.rbac.models import RecordScope
from core.rbac.registry import registry
from core.rbac.seeding import ensure_role_with_permissions, ensure_seed_user, ensure_tenant
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride, TenantSettings

SEED_PASSWORD = "demo12345"  # noqa: S105 — dev-only seed data, never a real credential

# Restricted principals (auth-and-rbac.md §6 rule 4) may never hold a staff permission
# key, and `DenyRestrictedPrincipals` keys off the role flag rather than the slug — so a
# seeded "student" role without it would pass every restricted-principal check.
RESTRICTED_ROLES = {"student", "guardian"}

# The modules whose screens this data is for. All four default off (each module's own
# `features.py`), and every endpoint behind one answers 403 `module_disabled` until a
# tenant is explicitly onboarded — seeded rows nothing can read would be
# indistinguishable from not seeding at all.
SEEDED_MODULES = ("module.students", "module.staff", "module.academics", "module.timetable")

CAMPUS_CODE = "MAIN"
CLASS_NAMES = ("Grade 1", "Grade 2")
SECTION_NAMES = ("A", "B")
SESSION_NAME = "Demo Academic Year"
STUDENTS_PER_SECTION = 6

# (code, name, employee number of the teacher who teaches it). One teacher per subject,
# which is what keeps the seeded week free of `teacher_double_booked`.
SUBJECTS = (
    ("MATH", "Mathematics", "DEMO-T-1"),
    ("ENG", "English", "DEMO-T-2"),
    ("SCI", "Science", "DEMO-T-3"),
)

# (employee_number, first_name, last_name, staff_type, phone). Both staff types are
# represented because the staff screens filter on it, and a list where every row reads
# "Teaching" cannot show that the filter works.
STAFF = (
    ("DEMO-T-1", "Ayesha", "Khan", StaffType.TEACHING, "+15551000001"),
    ("DEMO-T-2", "Bilal", "Ahmed", StaffType.TEACHING, "+15551000002"),
    ("DEMO-T-3", "Sara", "Malik", StaffType.TEACHING, "+15551000003"),
    ("DEMO-NT-1", "Imran", "Qureshi", StaffType.NON_TEACHING, "+15551000004"),
    ("DEMO-NT-2", "Fatima", "Raza", StaffType.NON_TEACHING, "+15551000005"),
)

# The bell schedule, seeded tenant-wide (`campus=None`, which Period's help text defines
# as "every campus") exactly as `seed_e2e_data` does: `period_wrong_campus` is a hard
# conflict, so a campus-pinned schedule breaks any grid built on a different campus.
# (name, sequence, start, end, is_break)
PERIODS = (
    ("Period 1", 1, time(8, 0), time(8, 45), False),
    ("Period 2", 2, time(8, 45), time(9, 30), False),
    ("Recess", 3, time(9, 30), time(9, 50), True),
    ("Period 3", 4, time(9, 50), time(10, 35), False),
)

# (code, name, room_type, capacity). Capacity sits above the seeded section's roll so the
# one soft finding these could raise, `room_over_capacity`, stays quiet.
ROOMS = (
    ("R-101", "Room 101", RoomType.CLASSROOM, 35),
    ("R-102", "Room 102", RoomType.CLASSROOM, 35),
)

# The section that gets a published week, and the periods each subject occupies in it.
# One subject per period per day: `subject_repeated_in_day` warns above one occurrence of
# a subject per section per day, so the three run once each rather than twice on any one.
TIMETABLED_SECTION = ("Grade 1", "A")
TIMETABLE_PLAN = (("MATH", 1), ("ENG", 2), ("SCI", 4))
TIMETABLE_WEEKDAYS = range(5)  # Monday-Friday; `day_of_week` matches `date.weekday()`.

# One per seeded student, so a roster is scannable rather than 24 rows of the same name.
STUDENT_FIRST_NAMES = (
    "Zainab",
    "Ali",
    "Mariam",
    "Hamza",
    "Amna",
    "Usman",
    "Sana",
    "Omar",
    "Hira",
    "Ahmed",
    "Noor",
    "Faisal",
    "Iqra",
    "Zain",
    "Laiba",
    "Talha",
    "Areeba",
    "Danish",
    "Rimsha",
    "Waqas",
    "Sadia",
    "Kashif",
    "Mahnoor",
    "Adeel",
)

CREDENTIALS_FILENAME = "DEV_LOGINS.md"


class Command(BaseCommand):
    help = (
        "Seed one login per canonical RBAC role plus baseline school data in the "
        "'demo' tenant, and write every login to DEV_LOGINS.md."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = ensure_tenant(DEMO_TENANT_SLUG, "Demo School")

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)
            for key in SEEDED_MODULES:
                self._enable_module(tenant, key)

            campus = self._ensure_campus(tenant)
            sections = self._ensure_classes_and_sections(tenant, campus)
            session = self._ensure_session(tenant)
            subjects = self._ensure_subjects(tenant)
            self._ensure_curriculum(tenant, session, sections, subjects)
            staff = self._ensure_staff(tenant, campus)
            self._ensure_allocations(tenant, session, sections, subjects, staff)
            self._ensure_students(tenant, campus, session, sections)

            periods = self._ensure_periods(tenant)
            rooms = self._ensure_rooms(tenant, campus)
            section = sections[TIMETABLED_SECTION[0]][TIMETABLED_SECTION[1]]
            self._ensure_timetable(tenant, session, section, subjects, staff, periods, rooms)

        credentials = self._seed_role_logins(tenant)
        path = self._write_credentials_file(tenant, credentials)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(credentials)} role logins in tenant '{tenant.slug}' — "
                f"credentials written to {path}"
            )
        )

    # ------------------------------------------------------------------
    # Role logins, derived from the registry rather than a hand-kept list
    # ------------------------------------------------------------------

    def _seed_role_logins(self, tenant: Tenant) -> list[tuple[str, str]]:
        """Returns (role_slug, email) for every role seeded.

        Reading the roles out of the registry rather than listing them here is what keeps
        this honest: the set is exactly the roles some shipped permission grants something
        to, so a role that gains its first key, or a module that adds a role, shows up on
        the next run with the right permissions and no edit to this file.
        """
        specs = registry.all()
        role_slugs = sorted({role for spec in specs for role in spec.default_roles})

        credentials: list[tuple[str, str]] = []
        for slug in role_slugs:
            label = slug.replace("_", " ").title()
            role = ensure_role_with_permissions(
                tenant,
                slug,
                label,
                [spec.key for spec in specs if slug in spec.default_roles],
                is_restricted_principal=slug in RESTRICTED_ROLES,
            )
            email = f"{slug}@demo.localhost"
            ensure_seed_user(
                tenant,
                role,
                email=email,
                password=SEED_PASSWORD,
                first_name=label,
                last_name="Demo",
                # A restricted principal at `ALL` would see every record in the tenant,
                # which is the opposite of what logging in as one is for.
                scope=RecordScope.OWN if slug in RESTRICTED_ROLES else RecordScope.ALL,
            )
            credentials.append((slug, email))
        return credentials

    def _write_credentials_file(self, tenant: Tenant, credentials: list[tuple[str, str]]) -> Path:
        rows = "\n".join(
            f"| `{slug}` | `{email}` | `{SEED_PASSWORD}` |" for slug, email in credentials
        )
        path = self._repo_root() / CREDENTIALS_FILENAME
        path.write_text(
            f"""# Local dev logins

Generated by `manage.py seed_all_roles`. Re-run the command rather than editing
this file. Dev-only fake credentials against a local database — they mean nothing
anywhere else, which is why writing them down is safe and why this file is
git-ignored anyway.

Tenant: `{tenant.slug}` ({tenant.name}). Every account uses the same password.

| Role | Email | Password |
| --- | --- | --- |
{rows}
"""
        )
        return path

    def _repo_root(self) -> Path:
        """The monorepo root, found by walking up to the `.git` directory.

        Not a fixed number of `.parent` hops: this file sits six levels below the
        repository root but only four below `apps/api`, and the API's own container
        bind-mounts `apps/api` alone — so a hop count that is right on a developer's
        machine indexes past the filesystem root inside the container. Falling back to
        `apps/api` puts the file somewhere real in that case instead of crashing.
        """
        here = Path(__file__).resolve()
        for candidate in here.parents:
            if (candidate / ".git").exists():
                return candidate
        return here.parents[4]

    # ------------------------------------------------------------------
    # The school itself
    # ------------------------------------------------------------------

    def _enable_module(self, tenant: Tenant, key: str) -> None:
        """`update_or_create`, not `get_or_create`: an override left `enabled=False` by an
        earlier run would survive, and `get_or_create` only applies `defaults` on
        creation — silently reinstating the `module_disabled` 403s this step exists to
        prevent."""
        flag = FeatureFlag.objects.get(key=key)
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "local dev seed"},
        )

    def _ensure_campus(self, tenant: Tenant) -> Campus:
        campus, _ = Campus.objects.get_or_create(
            tenant=tenant,
            code=CAMPUS_CODE,
            defaults={"name": "Main Campus", "is_primary": True, "is_active": True},
        )
        return campus

    def _ensure_classes_and_sections(
        self, tenant: Tenant, campus: Campus
    ) -> dict[str, dict[str, Section]]:
        sections: dict[str, dict[str, Section]] = {}
        for level, class_name in enumerate(CLASS_NAMES, start=1):
            school_class, _ = Class.objects.get_or_create(
                tenant=tenant, name=class_name, defaults={"level": level, "is_active": True}
            )
            sections[class_name] = {}
            for section_name in SECTION_NAMES:
                section, _ = Section.objects.get_or_create(
                    tenant=tenant,
                    school_class=school_class,
                    campus=campus,
                    name=section_name,
                    defaults={"capacity": 30, "is_active": True},
                )
                sections[class_name][section_name] = section
        return sections

    def _ensure_session(self, tenant: Tenant) -> AcademicSession:
        """A session already under way — started a month ago, running a year.

        Dated relative to today rather than pinned, so the seeded school stays "current"
        however long after this command was written someone runs it.
        """
        existing = AcademicSession.objects.filter(tenant=tenant, name=SESSION_NAME).first()
        if existing is not None:
            return existing

        start_date = timezone.now().date() - timedelta(days=30)
        end_date = start_date + timedelta(days=364)

        session = AcademicSession.objects.create(
            tenant=tenant,
            name=SESSION_NAME,
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

    def _ensure_subjects(self, tenant: Tenant) -> dict[str, Subject]:
        subjects = {}
        for code, name, _teacher in SUBJECTS:
            subject, _ = Subject.objects.get_or_create(
                tenant=tenant, code=code, defaults={"name": name, "is_active": True}
            )
            subjects[code] = subject
        return subjects

    def _ensure_curriculum(
        self,
        tenant: Tenant,
        session: AcademicSession,
        sections: dict[str, dict[str, Section]],
        subjects: dict[str, Subject],
    ) -> None:
        """Every class studies every seeded subject.

        Written through the ORM rather than `services.map_subject_to_class`, which is the
        API's path and raises `Conflict` on a duplicate — a second run would fail instead
        of converging. `campus=None` means "applies to every campus" (the field's own help
        text), and the unique constraint's `nulls_distinct=False` is what makes finding
        the row again on a re-run work.
        """
        for class_sections in sections.values():
            school_class = next(iter(class_sections.values())).school_class
            for subject in subjects.values():
                ClassSubject.objects.get_or_create(
                    tenant=tenant,
                    academic_session=session,
                    school_class=school_class,
                    subject=subject,
                    campus=None,
                    defaults={"weekly_periods": 4, "is_elective": False},
                )

    def _ensure_staff(self, tenant: Tenant, campus: Campus) -> dict[str, Staff]:
        """Explicit `employee_number`s rather than `services.create_staff`, which allocates
        one from the tenant's numbering pattern — a fresh number every run, so re-seeding
        could not find these rows again and would pile up staff. The number is the
        idempotency key here, exactly as `admission_number` is for a student."""
        staff = {}
        for employee_number, first_name, last_name, staff_type, phone in STAFF:
            record, _ = Staff.objects.get_or_create(
                tenant=tenant,
                employee_number=employee_number,
                defaults={
                    "first_name": first_name,
                    "last_name": last_name,
                    "staff_type": staff_type,
                    "employment_status": EmploymentStatus.ACTIVE,
                    "campus": campus,
                    "joining_date": "2026-01-01",
                    "phone": phone,
                },
            )
            staff[employee_number] = record
        return staff

    def _ensure_allocations(
        self,
        tenant: Tenant,
        session: AcademicSession,
        sections: dict[str, dict[str, Section]],
        subjects: dict[str, Subject],
        staff: dict[str, Staff],
    ) -> None:
        """Each subject's teacher, allocated to every section.

        Not bookkeeping: `conflicts._unallocated_teachers` is a *hard* finding, so a
        published cell whose teacher holds no allocation for that (section, subject)
        reports `teacher_not_allocated` and refuses to publish. Written through the ORM
        for the same reason as the curriculum above.
        """
        for code, _name, employee_number in SUBJECTS:
            for class_sections in sections.values():
                for section in class_sections.values():
                    TeacherSubjectAllocation.objects.get_or_create(
                        tenant=tenant,
                        academic_session=session,
                        section=section,
                        subject=subjects[code],
                        staff=staff[employee_number],
                        defaults={"is_primary": True, "effective_from": session.start_date},
                    )

    def _ensure_students(
        self,
        tenant: Tenant,
        campus: Campus,
        session: AcademicSession,
        sections: dict[str, dict[str, Section]],
    ) -> None:
        """Students *and* their enrollments — a `Student` row alone has no class or
        section, so the rosters and section-filtered lists the screens are built around
        would still read empty."""
        genders = (Gender.FEMALE, Gender.MALE)
        roll = 1
        for class_sections in sections.values():
            for section in class_sections.values():
                for _ in range(STUDENTS_PER_SECTION):
                    index = roll - 1
                    student, _ = Student.objects.get_or_create(
                        tenant=tenant,
                        admission_number=f"DEMO-{roll:04d}",
                        defaults={
                            "first_name": STUDENT_FIRST_NAMES[index % len(STUDENT_FIRST_NAMES)],
                            "last_name": "Demo",
                            "date_of_birth": "2015-06-01",
                            "gender": genders[index % len(genders)],
                            "campus": campus,
                            "admission_date": session.start_date,
                        },
                    )
                    # Keyed on (student, session), which is the model's own unique
                    # constraint — one enrollment per student per session.
                    StudentEnrollment.objects.get_or_create(
                        tenant=tenant,
                        student=student,
                        academic_session=session,
                        defaults={
                            "school_class": section.school_class,
                            "section": section,
                            "roll_number": str(roll),
                            "enrollment_date": session.start_date,
                            "status": EnrollmentStatus.ACTIVE,
                        },
                    )
                    roll += 1

    # ------------------------------------------------------------------
    # Timetable
    # ------------------------------------------------------------------

    def _ensure_periods(self, tenant: Tenant) -> dict[int, Period]:
        """The bell schedule, keyed by `sequence` because every cell below names the period
        it runs in and ids are generated per run.

        Written through the ORM rather than `PeriodSerializer`, whose `validate` calls
        `assert_period_does_not_overlap` and would raise on the second run. `campus=None`
        is part of the *lookup*, not just a default: `periods_unique_sequence_per_campus`
        is `nulls_distinct=False` precisely so a tenant-wide sequence is unique, which is
        what makes finding the row again work.
        """
        periods = {}
        for name, sequence, start_time, end_time, is_break in PERIODS:
            period, _ = Period.objects.get_or_create(
                tenant=tenant,
                campus=None,
                sequence=sequence,
                defaults={
                    "name": name,
                    "start_time": start_time,
                    "end_time": end_time,
                    "is_break": is_break,
                    "weekdays": None,
                },
            )
            periods[sequence] = period
        return periods

    def _ensure_rooms(self, tenant: Tenant, campus: Campus) -> dict[str, Room]:
        """`rooms_unique_code_per_campus` makes (campus, code) the idempotency key, the
        same way `code` is for a campus."""
        rooms = {}
        for code, name, room_type, capacity in ROOMS:
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

    def _ensure_timetable(
        self,
        tenant: Tenant,
        session: AcademicSession,
        section: Section,
        subjects: dict[str, Subject],
        staff: dict[str, Staff],
        periods: dict[int, Period],
        rooms: dict[str, Room],
    ) -> None:
        """A published week for one section.

        Published rather than draft because that is the state anything downstream can
        read: `GET /timetables/my` serves published rows exclusively. The rows are written
        already-published rather than by calling `publish_section_timetable`, which
        supersedes the current version and would end-date this same grid on every re-seed.

        Only one section gets a week on purpose. Each subject has exactly one teacher, so
        giving every section the same plan would put that teacher in four rooms at once —
        `teacher_double_booked`, a hard conflict and a partial unique index besides. The
        other three sections showing an empty grid is also the more realistic fixture: it
        is what a school mid-build actually looks like.
        """
        classroom = rooms["R-101"]
        for weekday in TIMETABLE_WEEKDAYS:
            for code, sequence in TIMETABLE_PLAN:
                employee_number = next(t for c, _n, t in SUBJECTS if c == code)
                TimetableSlot.objects.get_or_create(
                    tenant=tenant,
                    academic_session=session,
                    section=section,
                    day_of_week=weekday,
                    period=periods[sequence],
                    defaults={
                        "subject": subjects[code],
                        "staff": staff[employee_number],
                        "room": classroom,
                        "notes": None,
                        "status": SlotStatus.PUBLISHED,
                        # The day this version came into force, which
                        # `slot_version_window` reads back when a past date is asked for.
                        "effective_from": session.start_date,
                    },
                )
