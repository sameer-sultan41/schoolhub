"""Factories for the communication tests.

Re-exports `school_organization`'s tenant/user factories and `grant`/
`authenticate`, matching every other module's `tests/factories.py`. This
module's first PR has no student/campus dependency at all — templates and
preferences are pure tenant + user concerns — so nothing else is pulled in yet.
"""

from __future__ import annotations

import uuid

import factory

from apps.communication.models import NotificationPreference, NotificationTemplateOverride
from apps.school_organization.tests.factories import (  # noqa: F401 — re-exported
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
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
