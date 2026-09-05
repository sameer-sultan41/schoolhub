"""Factories and auth helpers for the school-organization tests.

Every factory writes through the tenant-scoped default manager, so callers must
be inside ``tenant_context(...)``: PostgreSQL's WITH CHECK clause on the RLS
policy rejects an insert whose tenant_id does not match the session GUC. That is
deliberate — a test that forgets the context fails loudly instead of silently
writing cross-tenant rows.
"""

from __future__ import annotations

import datetime
import uuid

import factory
from django.core.cache import cache

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Department,
    House,
    Section,
    Subject,
    Term,
)
from core.rbac.models import Permission, RecordScope, Role, RolePermission, User, UserRole
from core.tenancy.models import Tenant, TenantStatus

TEST_PASSWORD = "test-password-12345"

SESSION_START = datetime.date(2026, 4, 1)
SESSION_END = datetime.date(2027, 3, 31)


class TenantFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Tenant

    name = factory.Sequence(lambda n: f"Test School {n}")
    slug = factory.Sequence(lambda n: f"test-school-{n}")
    status = TenantStatus.ACTIVE
    timezone = "UTC"
    locale = "en"
    currency = "USD"


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User

    email = factory.Sequence(lambda n: f"staff{n}@example.test")
    first_name = "Test"
    last_name = "Staff"
    is_active = True
    tenant = factory.SubFactory(TenantFactory)

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        self.set_password(extracted or TEST_PASSWORD)
        if create:
            self.save(update_fields=["password"])


class CampusFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Campus

    name = factory.Sequence(lambda n: f"Campus {n}")
    code = factory.Sequence(lambda n: f"CMP{n:03d}")
    is_active = True


class DepartmentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Department

    name = factory.Sequence(lambda n: f"Department {n}")
    code = factory.Sequence(lambda n: f"DEP{n:03d}")
    is_active = True


class AcademicSessionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = AcademicSession

    name = factory.Sequence(lambda n: f"20{26 + n}-{27 + n}")
    start_date = SESSION_START
    end_date = SESSION_END


class TermFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Term

    name = factory.Sequence(lambda n: f"Term {n}")
    sequence = factory.Sequence(lambda n: n + 1)
    start_date = SESSION_START
    end_date = SESSION_END


class ClassFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Class

    name = factory.Sequence(lambda n: f"Grade {n}")
    level = factory.Sequence(lambda n: n + 1)
    is_active = True


class SectionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Section

    name = factory.Sequence(lambda n: f"S{n}")
    capacity = 30
    is_active = True


class SubjectFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Subject

    name = factory.Sequence(lambda n: f"Subject {n}")
    code = factory.Sequence(lambda n: f"SUB{n:03d}")
    is_active = True


class ClassSubjectFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = ClassSubject

    weekly_periods = 4


class HouseFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = House

    name = factory.Sequence(lambda n: f"House {n}")


def grant(
    user: User,
    *permission_keys: str,
    scope: str = RecordScope.ALL,
    scope_ref: uuid.UUID | None = None,
    is_restricted_principal: bool = False,
) -> Role:
    """Give ``user`` a role holding exactly ``permission_keys``.

    Built row by row rather than through a seed fixture so each test states the
    exact permissions it depends on — a test that passes only because the seed is
    generous proves nothing about the endpoint's own check.

    ``scope``/``scope_ref`` narrow the assignment the way a real one does, so a
    record-scope test does not have to hand-build ``Role``/``Permission``/
    ``UserRole`` rows itself. Both caches keyed on the user are evicted, not just
    the permission-key one — ``user_scopes`` has its own (core/rbac/permissions.py),
    and a stale entry there is exactly what makes a scope test pass for the wrong
    reason.
    """
    role = Role.objects.create(
        tenant=user.tenant,
        slug=f"test-role-{uuid.uuid4().hex[:8]}",
        name="Test role",
        is_restricted_principal=is_restricted_principal,
    )
    for key in permission_keys:
        module, resource, action = key.split(".")
        permission, _ = Permission.objects.get_or_create(
            key=key,
            defaults={"module": module, "resource": resource, "action": action},
        )
        RolePermission.objects.create(role=role, permission=permission)

    UserRole.objects.create(
        user=user, role=role, tenant=user.tenant, scope=scope, scope_ref=scope_ref
    )
    cache.delete(f"perm-keys:{user.pk}")
    cache.delete(f"scopes:{user.pk}")
    return role


def authenticate(client, user: User) -> None:
    """Authenticate for both layers.

    ``force_login`` gives the Django session that TenantMiddleware reads to resolve
    ``request.tenant``; the bearer token satisfies DRF, whose only configured
    authentication class is JWT. Skipping either leaves the request half-authenticated.
    """
    from rest_framework_simplejwt.tokens import AccessToken

    client.force_login(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
