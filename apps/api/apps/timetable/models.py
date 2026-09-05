"""Models for the timetable module.

Behaviour: docs/03-modules/timetable.md. Column-level specs:
docs/05-database/entities/academics.md §"Scheduling (module: timetable)".

The three partial unique indexes on `timetable_slots` are the module's spine.
They enforce the hard conflicts (§11) at the database, so a race between two
admins editing the same grid cannot produce a double-booked teacher even if both
passed the service-level check a moment earlier. Each is scoped to *published,
current* rows only, which is what lets drafts hold conflicts while they are being
worked on — the whole point of a draft.

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001 suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from core.tenancy.models import TenantOwnedModel


class RoomType(models.TextChoices):
    CLASSROOM = "classroom", "Classroom"
    LAB = "lab", "Lab"
    LIBRARY = "library", "Library"
    AUDITORIUM = "auditorium", "Auditorium"
    SPORTS = "sports", "Sports"
    OFFICE = "office", "Office"
    OTHER = "other", "Other"


class SlotStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"


class SubstitutionStatus(models.TextChoices):
    """`completed` and `cancelled` are declared and **unreachable today.**

    Both are in the locked entity map's enum, so dropping them would put the
    column out of step with the spec for a column that costs nothing to keep
    wide. But `decide_substitution` only ever produces `confirmed` or
    `declined`, and §16 declares no endpoint that could produce either of these
    — so they are reserved, not implemented, and this says so rather than
    leaving a reader to infer a workflow from an enum.

    What each is waiting on:

    - `completed` needs a signal that the covered period actually ran, which is
      the attendance module's to give (§7.2 has the absence feed arriving from
      there). Nothing in this module knows a period happened.
    - `cancelled` needs a `:cancel` action for the case §7.2's flowchart stops
      short of — the absent teacher returns and confirmed cover must be
      released. That is a real gap with a real cost: a confirmed substitution
      holds `subs_substitute_one_per_period` for that (date, period), so the
      substitute cannot be assigned elsewhere and nothing can let them go.
      Building it means inventing an endpoint §16 does not list and a
      notification §12 does not list, so it waits on the module doc.
    """

    PROPOSED = "proposed", "Proposed"
    CONFIRMED = "confirmed", "Confirmed"
    DECLINED = "declined", "Declined"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class Room(TenantOwnedModel):
    """A physical room. Also referenced by `sections.room_id` and, later, exams."""

    campus = models.ForeignKey(
        "school_organization.Campus", on_delete=models.PROTECT, related_name="rooms"
    )
    name = models.CharField(max_length=80)
    code = models.CharField(max_length=20)
    room_type = models.CharField(
        max_length=20, choices=RoomType.choices, default=RoomType.CLASSROOM
    )
    capacity = models.PositiveSmallIntegerField(null=True, blank=True)
    building = models.CharField(max_length=80, null=True, blank=True)
    floor = models.CharField(max_length=20, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "rooms"
        ordering = ["campus_id", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "campus", "code"],
                name="rooms_unique_code_per_campus",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "campus", "room_type"], name="rooms_campus_type_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.code} ({self.name})"


class Period(TenantOwnedModel):
    """One slot of the bell schedule — a teaching period or a break.

    `campus` is nullable and means "all campuses", which is why the uniqueness
    constraint below cannot be a plain unique index: PostgreSQL treats NULLs as
    distinct, so two tenant-wide periods could otherwise share a sequence.
    `nulls_distinct=False` is what makes the constraint mean what the entity doc
    says it means.
    """

    campus = models.ForeignKey(
        "school_organization.Campus",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="periods",
        help_text="Null = every campus.",
    )
    name = models.CharField(max_length=50, help_text='e.g. "Period 1", "Recess".')
    sequence = models.PositiveSmallIntegerField(help_text="Daily order, 1-based.")
    start_time = models.TimeField(help_text="Local to the tenant/campus timezone.")
    end_time = models.TimeField()
    is_break = models.BooleanField(default=False, help_text="Breaks are never schedulable (§5.1).")
    weekdays = models.JSONField(
        null=True,
        blank=True,
        help_text="Applicable weekdays as 0-6; null = the tenant's working days.",
    )

    class Meta:
        db_table = "periods"
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "campus", "sequence"],
                name="periods_unique_sequence_per_campus",
                condition=models.Q(deleted_at__isnull=True),
                nulls_distinct=False,
            ),
            models.CheckConstraint(
                condition=models.Q(end_time__gt=models.F("start_time")),
                name="periods_end_after_start",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "campus"], name="periods_tenant_campus_idx")]

    def __str__(self) -> str:
        return f"{self.sequence}. {self.name}"


class TimetableSlot(TenantOwnedModel):
    """One cell of the weekly grid: (session, section, weekday, period).

    `subject` and `staff` are nullable because a homeroom or assembly slot has
    neither — the grid is not only teaching periods.
    """

    academic_session = models.ForeignKey(
        "school_organization.AcademicSession",
        on_delete=models.PROTECT,
        related_name="timetable_slots",
    )
    section = models.ForeignKey(
        "school_organization.Section", on_delete=models.PROTECT, related_name="timetable_slots"
    )
    day_of_week = models.PositiveSmallIntegerField(
        help_text="0-6; the week's start comes from tenant configuration."
    )
    period = models.ForeignKey(Period, on_delete=models.PROTECT, related_name="timetable_slots")
    subject = models.ForeignKey(
        "school_organization.Subject",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="timetable_slots",
        help_text="Null for homeroom/assembly slots.",
    )
    staff = models.ForeignKey(
        "staff_management.Staff",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="timetable_slots",
        db_column="staff_id",
    )
    room = models.ForeignKey(
        Room, on_delete=models.PROTECT, null=True, blank=True, related_name="timetable_slots"
    )
    status = models.CharField(max_length=20, choices=SlotStatus.choices, default=SlotStatus.DRAFT)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(
        null=True, blank=True, help_text="Null = current. Set on a mid-session revision."
    )
    notes = models.CharField(
        max_length=200, null=True, blank=True, help_text='Per-cell note, e.g. "double period".'
    )

    class Meta:
        db_table = "timetable_slots"
        ordering = ["day_of_week", "period__sequence"]
        constraints = [
            # The three hard conflicts (§11), enforced at the database rather than
            # only in the service: two admins editing the same grid concurrently
            # both pass a service check and only one can win the insert.
            #
            # Every one is scoped to published *and* current rows. Drafts are
            # deliberately allowed to conflict — resolving them is what the
            # validation run is for — and an end-dated slot must not block its
            # own replacement.
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "section", "day_of_week", "period"],
                name="slots_one_per_section_cell",
                condition=models.Q(
                    status="published", effective_to__isnull=True, deleted_at__isnull=True
                ),
            ),
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "staff", "day_of_week", "period"],
                name="slots_teacher_not_double_booked",
                condition=models.Q(
                    status="published",
                    effective_to__isnull=True,
                    deleted_at__isnull=True,
                    staff__isnull=False,
                ),
            ),
            models.UniqueConstraint(
                fields=["tenant", "academic_session", "room", "day_of_week", "period"],
                name="slots_room_not_double_booked",
                condition=models.Q(
                    status="published",
                    effective_to__isnull=True,
                    deleted_at__isnull=True,
                    room__isnull=False,
                ),
            ),
            models.CheckConstraint(
                condition=models.Q(day_of_week__gte=0, day_of_week__lte=6),
                name="slots_day_of_week_range",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "section", "status"], name="slots_section_status_idx"),
            models.Index(
                fields=["tenant", "academic_session", "staff"], name="slots_session_staff_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.section_id} d{self.day_of_week} p{self.period_id}"

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` — a teacher sees the slots they teach (§4).

        Students and guardians reach their timetable through
        `GET /timetables/my`, which resolves a section rather than a staff row;
        this hook covers the staff case only.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return queryset.none()
        return queryset.filter(staff__user_id=user.pk, staff__deleted_at__isnull=True)


class TeacherSubstitution(TenantOwnedModel):
    """A dated override of one slot's teacher, and optionally its room.

    Overrides a *published* slot for specific dates only — the base timetable is
    untouched (§7.2), which is why this is its own row rather than an edit.

    `room` is here because §6 and §15 both promise "ad-hoc room change supported
    on the substitution" while the locked entity map's column list omitted it.
    Adding the column is the cheaper half of that disagreement to fix: the
    feature is named twice in the module doc, a substitute teacher genuinely does
    get moved to a free lab, and a nullable FK costs nothing when unused. The
    entity doc is updated in the same commit rather than left to disagree.

    `period` is a copy of `timetable_slot.period_id`, and it is here for the same
    reason `timetable_slots` carries its three partial unique indexes: the two
    occupancy rules below are per *period* on a date, and a unique index cannot
    reach through a join to get one. The copy is safe to trust because neither
    end of it moves — a substitution's slot is fixed at creation (§16 declares no
    PATCH), and the slot it points at is published, which §5.7 makes immutable in
    place. `services.create_substitution` is the single writer and sets it from
    the slot.
    """

    timetable_slot = models.ForeignKey(
        TimetableSlot, on_delete=models.PROTECT, related_name="substitutions"
    )
    period = models.ForeignKey(
        Period,
        on_delete=models.PROTECT,
        related_name="substitutions",
        help_text="Copied from the slot; see the class docstring for why it is denormalised.",
    )
    date = models.DateField(help_text="Must fall on the slot's weekday and inside the session.")
    absent_staff = models.ForeignKey(
        "staff_management.Staff",
        on_delete=models.PROTECT,
        related_name="absences_covered",
        db_column="absent_staff_id",
    )
    substitute_staff = models.ForeignKey(
        "staff_management.Staff",
        on_delete=models.PROTECT,
        related_name="substitutions_taken",
        db_column="substitute_staff_id",
    )
    room = models.ForeignKey(
        Room,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="substitutions",
        help_text=("Ad-hoc room change for this date only (§6). Null = keep the slot's room."),
    )
    reason = models.CharField(max_length=200, null=True, blank=True)
    leave_request_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="leave_requests(id) — a plain UUID, not an FK: the attendance "
        "module that owns that table has not shipped yet.",
    )
    status = models.CharField(
        max_length=20, choices=SubstitutionStatus.choices, default=SubstitutionStatus.PROPOSED
    )

    class Meta:
        db_table = "teacher_substitutions"
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "timetable_slot", "date"],
                name="substitutions_one_per_slot_per_date",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.CheckConstraint(
                condition=~models.Q(substitute_staff=models.F("absent_staff")),
                name="substitutions_substitute_differs_from_absentee",
            ),
            # The occupancy half of §11's substitution rules, at the database for
            # the reason `timetable_slots`' indexes are: `services` checks with an
            # unlocked `.exists()`, so two proposals raised in the same second
            # both see a free teacher, or a free room, and both insert.
            #
            # Scoped to `proposed` and `confirmed` because only those hold the
            # slot — a declined proposal occupies nobody, and the same teacher
            # must stay available for cover after one is turned down.
            models.UniqueConstraint(
                fields=["tenant", "substitute_staff", "date", "period"],
                name="subs_substitute_one_per_period",
                condition=models.Q(deleted_at__isnull=True, status__in=("proposed", "confirmed")),
            ),
            models.UniqueConstraint(
                fields=["tenant", "room", "date", "period"],
                name="subs_room_one_per_period",
                condition=models.Q(
                    deleted_at__isnull=True,
                    status__in=("proposed", "confirmed"),
                    room__isnull=False,
                ),
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "substitute_staff", "date"], name="subs_substitute_date_idx"
            ),
            models.Index(fields=["tenant", "absent_staff", "date"], name="subs_absent_date_idx"),
            # Narrower than the room constraint above, which covers only
            # proposed/confirmed rows: §13's substitution report and the
            # filterset read declined ones too.
            models.Index(fields=["tenant", "room", "date"], name="subs_room_date_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.timetable_slot_id} on {self.date}"
