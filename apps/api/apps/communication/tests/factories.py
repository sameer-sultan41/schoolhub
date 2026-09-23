"""Factories for the communication tests.

Re-exports `school_organization`'s tenant/user/class/section/house factories
and `student_management`'s student/guardian factories — PR B's audience
resolution needs the whole enrollment graph, unlike PR A's pure tenant + user
concerns.
"""

from __future__ import annotations

import uuid

import factory

from apps.communication.models import (
    Announcement,
    AudienceType,
    Notice,
    NotificationPreference,
    NotificationTemplateOverride,
)
from apps.school_organization.tests.factories import (  # noqa: F401 — re-exported
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    HouseFactory,
    SectionFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.tests.factories import (  # noqa: F401 — re-exported
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

FEATURE = "module.communication"


def enable_feature(tenant, key: str = FEATURE) -> None:
    """Force ``key`` on for ``tenant`` — see fees_finance's identical helper."""
    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "communication test fixture"},
        )


class NotificationTemplateOverrideFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = NotificationTemplateOverride

    tenant = factory.SubFactory(TenantFactory)
    code = "test.event"
    name = "Test override"
    channel = NotificationChannel.IN_APP
    subject = "Overridden subject"
    body = "Overridden body"
    variables = factory.LazyFunction(list)


class NotificationPreferenceFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = NotificationPreference

    tenant = factory.SubFactory(TenantFactory)
    # Deliberately not a UserFactory() SubFactory: that would default to a
    # brand-new tenant of its own, not the row's own `tenant` above. Tests that
    # care which user this is pass `user_id=` explicitly.
    user_id = factory.LazyFunction(uuid.uuid4)
    event_category = NotificationCategory.GENERAL
    channel = NotificationChannel.EMAIL
    is_enabled = True


class AnnouncementFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Announcement

    tenant = factory.SubFactory(TenantFactory)
    title = factory.Sequence(lambda n: f"Announcement {n}")
    body = "Body text."
    audience_type = AudienceType.ALL


class NoticeFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Notice

    tenant = factory.SubFactory(TenantFactory)
    title = factory.Sequence(lambda n: f"Notice {n}")
    body = "Body text."
    audience_type = AudienceType.ALL
