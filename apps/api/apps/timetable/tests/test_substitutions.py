"""`/teacher-substitutions` — proposing cover and deciding on it (§7.2).

A substitution overrides a *published* slot for specific dates only; the base
timetable is untouched. Everything below is either that invariant or one of §11's
three substitution rules.
"""

from __future__ import annotations

import datetime
import uuid

from rest_framework import status

from apps.staff_management.models import EmploymentStatus, StaffType
from apps.timetable import services
from apps.timetable.models import SubstitutionStatus, TeacherSubstitution
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    TUESDAY,
    CampusFactory,
    PeriodFactory,
    RoomFactory,
    StaffFactory,
    TeacherAllocationFactory,
    TeacherSubstitutionFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.api.exceptions import Conflict
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

# A Monday — so the weekday rule passes and the session-window rule is what the
# test actually exercises — outside AcademicSessionFactory's 2026-27 window.
MONDAY_OUTSIDE_THE_SESSION = datetime.date(2028, 4, 3)


class SubstitutionTestCase(TimetableAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.slot = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            self.cover = StaffFactory(tenant=self.tenant, campus=self.campus)

    def payload(self, **overrides) -> dict:
        base = {
            "timetable_slot_id": str(self.slot.pk),
            "date": MONDAY.isoformat(),
            "absent_staff_id": str(self.teacher.pk),
            "substitute_staff_id": str(self.cover.pk),
            "reason": "Sick leave",
        }
        base.update(overrides)
        return base

    def propose(self, **overrides):
        return self.client.post(
            "/api/v1/teacher-substitutions", self.payload(**overrides), format="json"
        )


class ProposeSubstitutionTests(SubstitutionTestCase):
    def test_proposing_cover_needs_the_create_key(self) -> None:
        self.allow("timetable.timetable.view")

        self.assertEqual(self.propose().status_code, status.HTTP_403_FORBIDDEN)

        self.allow("timetable.substitution.create")
        self.assertEqual(self.propose().status_code, status.HTTP_201_CREATED)

    def test_a_new_substitution_starts_as_a_proposal(self) -> None:
        """§7.2 — the vice principal's decision is a separate step."""
        self.allow("timetable.substitution.create", "timetable.timetable.view")

        response = self.propose()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["status"], SubstitutionStatus.PROPOSED)
        with tenant_context(self.tenant.id):
            self.assertEqual(TeacherSubstitution.objects.alive().count(), 1)

    def test_status_cannot_be_set_on_create(self) -> None:
        """Otherwise a proposer could confirm their own cover and skip approval."""
        self.allow("timetable.substitution.create", "timetable.timetable.view")

        response = self.propose(status=SubstitutionStatus.CONFIRMED)

        self.assertEqual(response.json()["data"]["status"], SubstitutionStatus.PROPOSED)

    def test_only_a_published_slot_can_be_substituted(self) -> None:
        """Covering a draft cell would be covering a class nobody has been told about."""
        self.allow("timetable.substitution.create")
        draft = self.make_slot(period=self.periods[1])

        response = self.propose(timetable_slot_id=str(draft.pk))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_the_absentee_must_be_the_teacher_scheduled_for_that_slot(self) -> None:
        """§11 — otherwise a substitution silently replaces the wrong person."""
        self.allow("timetable.substitution.create")
        with tenant_context(self.tenant.id):
            bystander = StaffFactory(tenant=self.tenant, campus=self.campus)

        response = self.propose(absent_staff_id=str(bystander.pk))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("absent_staff_id", fields)

    def test_a_teacher_cannot_substitute_for_themselves(self) -> None:
        self.allow("timetable.substitution.create")

        response = self.propose(substitute_staff_id=str(self.teacher.pk))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_non_teaching_substitute_is_refused(self) -> None:
        self.allow("timetable.substitution.create")
        with tenant_context(self.tenant.id):
            clerk = StaffFactory(
                tenant=self.tenant, campus=self.campus, staff_type=StaffType.NON_TEACHING
            )

        response = self.propose(substitute_staff_id=str(clerk.pk))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_inactive_substitute_is_refused(self) -> None:
        self.allow("timetable.substitution.create")
        with tenant_context(self.tenant.id):
            self.cover.employment_status = EmploymentStatus.RESIGNED
            self.cover.save(update_fields=["employment_status"])

        response = self.propose()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_the_date_must_fall_on_the_slots_weekday(self) -> None:
        """A Tuesday cover for a Monday period would cover nothing."""
        self.allow("timetable.substitution.create")

        response = self.propose(date=TUESDAY.isoformat())

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("date", fields)

    def test_the_date_must_fall_inside_the_academic_session(self) -> None:
        self.allow("timetable.substitution.create")

        response = self.propose(date=MONDAY_OUTSIDE_THE_SESSION.isoformat())

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("date", fields)

    def test_a_substitute_already_teaching_that_period_is_refused(self) -> None:
        """§11's "free at that (date, period)" rule, first way of being busy."""
        self.allow("timetable.substitution.create")
        with tenant_context(self.tenant.id):
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=self.cover,
            )
        self.publish(self.make_slot(section=self.other_section, staff=self.cover, room=None))

        response = self.propose()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("substitute_staff_id", fields)

    def test_a_substitute_already_covering_that_period_is_refused(self) -> None:
        """The second way of being busy: another live substitution in the same cell."""
        self.allow("timetable.substitution.create")
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
            other_slot = self.make_slot(section=self.other_section, staff=colleague, room=None)
        other_slot = self.publish(other_slot)
        with tenant_context(self.tenant.id):
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=other_slot,
                date=MONDAY,
                absent_staff=colleague,
                substitute_staff=self.cover,
            )

        response = self.propose()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_declined_cover_no_longer_blocks_the_substitute(self) -> None:
        """Only proposed and confirmed rows occupy a teacher's period."""
        self.allow("timetable.substitution.create", "timetable.timetable.view")
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
            other_slot = self.make_slot(section=self.other_section, staff=colleague, room=None)
        other_slot = self.publish(other_slot)
        with tenant_context(self.tenant.id):
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=other_slot,
                date=MONDAY,
                absent_staff=colleague,
                substitute_staff=self.cover,
                status=SubstitutionStatus.DECLINED,
            )

        self.assertEqual(self.propose().status_code, status.HTTP_201_CREATED)

    def test_a_free_period_elsewhere_in_the_day_does_not_block(self) -> None:
        """Busy means busy *in that period*, not busy that day."""
        self.allow("timetable.substitution.create", "timetable.timetable.view")
        with tenant_context(self.tenant.id):
            later = PeriodFactory(tenant=self.tenant, sequence=70)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=self.cover,
            )
        self.publish(
            self.make_slot(section=self.other_section, staff=self.cover, period=later, room=None)
        )

        self.assertEqual(self.propose().status_code, status.HTTP_201_CREATED)


class DecideSubstitutionTests(SubstitutionTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.substitution = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=self.slot,
                date=MONDAY,
                absent_staff=self.teacher,
                substitute_staff=self.cover,
            )

    def decide(self, verb: str):
        return self.client.post(
            f"/api/v1/teacher-substitutions/{self.substitution.pk}:{verb}", {}, format="json"
        )

    def test_deciding_needs_the_approve_key_not_the_create_one(self) -> None:
        self.allow("timetable.substitution.create", "timetable.timetable.view")

        self.assertEqual(self.decide("approve").status_code, status.HTTP_403_FORBIDDEN)

        self.allow("timetable.substitution.approve")
        self.assertEqual(self.decide("approve").status_code, status.HTTP_200_OK)

    def test_approving_confirms_the_cover(self) -> None:
        self.allow("timetable.substitution.approve", "timetable.timetable.view")

        response = self.decide("approve")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["status"], SubstitutionStatus.CONFIRMED)
        with tenant_context(self.tenant.id):
            self.substitution.refresh_from_db()
        self.assertEqual(self.substitution.status, SubstitutionStatus.CONFIRMED)

    def test_rejecting_declines_the_cover(self) -> None:
        self.allow("timetable.substitution.approve", "timetable.timetable.view")

        response = self.decide("reject")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["status"], SubstitutionStatus.DECLINED)

    def test_a_decided_substitution_cannot_be_decided_again(self) -> None:
        """The state machine is one-way; a second decision is a 409, not a silent no-op."""
        self.allow("timetable.substitution.approve", "timetable.timetable.view")
        self.decide("approve")

        self.assertEqual(self.decide("reject").status_code, status.HTTP_409_CONFLICT)

    def test_a_decision_taken_on_a_stale_row_is_refused(self) -> None:
        """The guard has to outlive the read that precedes it.

        `decide_substitution` used to test the status of whatever row its caller
        had already fetched, so two decisions arriving together both saw
        `proposed`, both passed, and the second quietly overwrote the first — the
        losing approver was told their decision stuck. Holding a row from before
        someone else decided is the same situation without the thread, and it is
        the one a test can actually reach.
        """
        self.allow("timetable.substitution.approve", "timetable.timetable.view")
        with tenant_context(self.tenant.id):
            stale = TeacherSubstitution.objects.alive().get(pk=self.substitution.pk)
        self.decide("approve")

        with tenant_context(self.tenant.id), self.assertRaises(Conflict):
            services.decide_substitution(substitution=stale, approve=False, actor_id=self.user.pk)

        with tenant_context(self.tenant.id):
            self.substitution.refresh_from_db()
        self.assertEqual(self.substitution.status, SubstitutionStatus.CONFIRMED)

    def test_a_rejected_substitution_cannot_be_revived_by_approving(self) -> None:
        self.allow("timetable.substitution.approve", "timetable.timetable.view")
        self.decide("reject")

        self.assertEqual(self.decide("approve").status_code, status.HTTP_409_CONFLICT)

    def test_deciding_an_unknown_substitution_is_404(self) -> None:
        self.allow("timetable.substitution.approve")
        stray = uuid.uuid4()

        for verb in ("approve", "reject"):
            with self.subTest(verb=verb):
                response = self.client.post(
                    f"/api/v1/teacher-substitutions/{stray}:{verb}", {}, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SubstitutionListTests(SubstitutionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view")
        with tenant_context(self.tenant.id):
            self.mine = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=self.slot,
                date=MONDAY,
                absent_staff=self.teacher,
                substitute_staff=self.cover,
            )
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
            self.other_staff = colleague
        other_slot = self.publish(
            self.make_slot(
                section=self.other_section,
                staff=colleague,
                period=self.periods[1],
                room=None,
                day_of_week=1,
            )
        )
        with tenant_context(self.tenant.id):
            self.theirs = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=other_slot,
                date=TUESDAY,
                absent_staff=colleague,
                substitute_staff=self.teacher,
                status=SubstitutionStatus.CONFIRMED,
            )

    def ids(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/teacher-substitutions?{query}")
        return [row["id"] for row in response.json()["data"]]

    def test_it_filters_on_every_field_the_module_names(self) -> None:
        self.assertEqual(self.ids(f"date={MONDAY.isoformat()}"), [str(self.mine.pk)])
        self.assertEqual(self.ids("status=proposed"), [str(self.mine.pk)])
        self.assertEqual(self.ids(f"substitute_staff_id={self.cover.pk}"), [str(self.mine.pk)])
        self.assertEqual(self.ids(f"absent_staff_id={self.teacher.pk}"), [str(self.mine.pk)])

    def test_a_date_range_returns_both(self) -> None:
        """§13's substitution report is a range, not a day."""
        found = self.ids(f"date__gte={MONDAY.isoformat()}&date__lte={TUESDAY.isoformat()}")

        self.assertEqual(set(found), {str(self.mine.pk), str(self.theirs.pk)})

    def test_a_detail_read_returns_one_row(self) -> None:
        response = self.client.get(f"/api/v1/teacher-substitutions/{self.mine.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["id"], str(self.mine.pk))

    def test_a_substitution_cannot_be_patched_or_deleted(self) -> None:
        """§16 lists neither; approval is the only mutable state and has its own verbs."""
        self.allow_everything()

        self.assertEqual(
            self.client.patch(
                f"/api/v1/teacher-substitutions/{self.mine.pk}",
                {"reason": "changed"},
                format="json",
            ).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(
            self.client.delete(f"/api/v1/teacher-substitutions/{self.mine.pk}").status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def test_an_own_scoped_teacher_sees_only_the_cover_they_were_asked_to_take(self) -> None:
        """`scope_own_field` on this viewset resolves to the *substitute*."""
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.cover.user_id = user.pk
            self.cover.save(update_fields=["user_id"])
        grant(user, "timetable.timetable.view", scope=RecordScope.OWN)
        authenticate(self.client, user)

        self.assertEqual(self.ids(""), [str(self.mine.pk)])


class RoomOverrideTests(SubstitutionTestCase):
    """§6's ad-hoc room change, carried on the substitution.

    The module doc names it twice (§6 and §15) while the locked entity map's
    column list omitted it; the column is here and the entity doc now agrees.
    A room moved onto for one date is a real booking, so it earns the same clash
    guard the base grid's `room_double_booked` gives — otherwise the override
    would be the one way to double-book a room that nothing checks.
    """

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.lab = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)

    def test_a_proposal_can_move_the_class_to_a_free_room(self) -> None:
        response = self.propose(room_id=str(self.lab.pk))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["room_id"], str(self.lab.pk))

    def test_omitting_the_room_keeps_the_slot_in_its_own(self) -> None:
        """The base timetable is untouched by a substitution (§7.2), so "no room
        named" has to mean "no move", not "no room"."""
        response = self.propose()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertIsNone(response.json()["data"]["room_id"])

    def test_moving_into_a_room_another_section_holds_that_period_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
        self.publish(self.make_slot(section=self.other_section, staff=colleague, room=self.lab))

        response = self.propose(room_id=str(self.lab.pk))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("room_id", {row["field"] for row in response.json()["error"]["details"]})

    def test_two_substitutions_cannot_move_into_the_same_room_and_period(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
            other_cover = StaffFactory(tenant=self.tenant, campus=self.campus)
        rival = self.publish(self.make_slot(section=self.other_section, staff=colleague, room=None))
        with tenant_context(self.tenant.id):
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=rival,
                date=MONDAY,
                absent_staff=colleague,
                substitute_staff=other_cover,
                room=self.lab,
            )

        response = self.propose(room_id=str(self.lab.pk))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("room_id", {row["field"] for row in response.json()["error"]["details"]})

    def test_naming_the_slots_own_room_is_not_a_clash_with_itself(self) -> None:
        """Restating the room the class is already in is a no-op, not a booking
        collision with the very slot being covered."""
        response = self.propose(room_id=str(self.room.pk))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_a_foreign_tenants_room_does_not_resolve(self) -> None:
        other = TenantFactory()
        with tenant_context(other.id):
            campus = CampusFactory(tenant=other)
            stranger_room = RoomFactory(tenant=other, campus=campus)

        response = self.propose(room_id=str(stranger_room.pk))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_confirmed_room_change_shows_on_the_effective_timetable(self) -> None:
        """The point of the override: `GET /timetables/my?date=` is the endpoint
        that answers "where am I actually going today"."""
        proposal = self.propose(room_id=str(self.lab.pk)).json()["data"]
        self.client.post(f"/api/v1/teacher-substitutions/{proposal['id']}:approve")

        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.cover.user_id = user.pk
            self.cover.save(update_fields=["user_id"])
        grant(user, "timetable.timetable.view")
        authenticate(self.client, user)

        row = self.client.get(f"/api/v1/timetables/my?date={MONDAY.isoformat()}").json()["data"][0]

        self.assertEqual(row["room_id"], str(self.room.pk), "the base grid cell is unchanged")
        self.assertEqual(row["substitution"]["room_id"], str(self.lab.pk))
        self.assertEqual(row["substitution"]["room_name"], self.lab.name)
