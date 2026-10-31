"""A school with one enrolled student, their guardian and a class teacher.

The caller (`self.user`, from `CommunicationAPITestCase`) is a scope-`all`
staff member holding every communication key. The guardian and the class
teacher hold only the thread keys their real roles get, at their real scopes
(`own` and `assigned`), so a test passing for them is not passing on a
generous fixture.
"""

from __future__ import annotations

from apps.communication.models import MessageThread, ThreadType
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    GuardianFactory,
    MessageFactory,
    MessageThreadFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    UserFactory,
    grant,
)
from apps.staff_management.tests.factories import StaffFactory
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

GUARDIAN_THREAD_KEYS = (
    "communication.thread.view",
    "communication.thread.create",
    "communication.message.create",
)
STAFF_THREAD_KEYS = (*GUARDIAN_THREAD_KEYS, "communication.thread.close")


class ThreadAPITestCase(CommunicationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant)
            self.section = SectionFactory(
                tenant=self.tenant, campus=self.campus, school_class=self.school_class
            )
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

            self.guardian_user = UserFactory(tenant=self.tenant)
            grant(
                self.guardian_user,
                *GUARDIAN_THREAD_KEYS,
                scope=RecordScope.OWN,
                is_restricted_principal=True,
            )
            self.guardian_link = self.link_guardian(self.guardian_user)

    def link_guardian(self, user, **flags):
        """Link a guardian with a portal account to `self.student`."""
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=user.pk)
            return StudentGuardianFactory(
                tenant=self.tenant, student=self.student, guardian=guardian, **flags
            )

    def make_class_teacher(self):
        """A staff user, `assigned`-scoped, made class teacher of the student's section."""
        with tenant_context(self.tenant.id):
            teacher_user = UserFactory(tenant=self.tenant)
            grant(teacher_user, *STAFF_THREAD_KEYS, scope=RecordScope.ASSIGNED)
            staff = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=teacher_user.pk)
            self.section.class_teacher_staff_id = staff.pk
            self.section.save(update_fields=["class_teacher_staff_id"])
        return teacher_user

    def make_staff_with_role(self, slug: str):
        """A staff user holding a role named ``slug`` — routing looks roles up by slug."""
        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
            role = grant(user, *STAFF_THREAD_KEYS)
            role.slug = slug
            role.save(update_fields=["slug"])
        return user

    def set_fallback_role(self, slug: str) -> None:
        with tenant_context(self.tenant.id):
            row, _ = TenantSettings.objects.get_or_create(tenant=self.tenant)
            row.communication = {**row.communication, "thread_fallback_role": slug}
            row.save(update_fields=["communication"])

    def make_thread(self, *participants, **fields) -> MessageThread:
        """A thread between ``participants``, with one opening message from the first."""
        with tenant_context(self.tenant.id):
            thread = MessageThreadFactory(
                tenant=self.tenant,
                participant_user_ids=[str(user.pk) for user in participants],
                thread_type=fields.pop("thread_type", ThreadType.INTERNAL),
                **fields,
            )
            MessageFactory(thread=thread, sender_id=participants[0].pk)
        return thread
