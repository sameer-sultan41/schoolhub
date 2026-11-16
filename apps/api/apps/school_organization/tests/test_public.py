"""`public_departments`, `public_classes` and `primary_campus_contact` for the website."""

from __future__ import annotations

from django.test import TestCase

from apps.school_organization.models import Campus
from apps.school_organization.public import (
    format_address,
    primary_campus_contact,
    public_classes,
    public_departments,
)
from apps.school_organization.tests.factories import (
    CampusFactory,
    ClassFactory,
    DepartmentFactory,
    TenantFactory,
)
from core.tenancy.context import tenant_context


class PublicOrganizationTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()
        ctx = tenant_context(self.tenant.id)
        ctx.__enter__()
        self.addCleanup(ctx.__exit__, None, None, None)

    def test_departments_only_flagged_and_active(self) -> None:
        shown = DepartmentFactory(tenant=self.tenant, show_on_website=True, description="STEM")
        DepartmentFactory(tenant=self.tenant)
        DepartmentFactory(tenant=self.tenant, show_on_website=True, is_active=False)
        rows = public_departments()
        self.assertEqual([(r.id, r.description) for r in rows], [(shown.id, "STEM")])

    def test_classes_only_flagged_and_active_in_level_order(self) -> None:
        high = ClassFactory(tenant=self.tenant, level=9, show_on_website=True)
        low = ClassFactory(tenant=self.tenant, level=2, show_on_website=True)
        ClassFactory(tenant=self.tenant, level=3)
        ClassFactory(tenant=self.tenant, level=4, show_on_website=True, is_active=False)
        self.assertEqual([r.id for r in public_classes()], [low.id, high.id])

    def test_departments_with_equal_names_list_in_id_order(self) -> None:
        departments = [
            DepartmentFactory(tenant=self.tenant, name="Same", show_on_website=True)
            for _ in range(2)
        ]
        self.assertEqual([r.id for r in public_departments()], sorted(d.id for d in departments))

    def test_contact_comes_from_the_primary_campus(self) -> None:
        CampusFactory(tenant=self.tenant, phone="000")
        CampusFactory(
            tenant=self.tenant,
            is_primary=True,
            phone="+92 300 1",
            email="hello@school.test",
            address={"line1": "1 Main St", "city": "Lahore", "country": "PK"},
        )
        contact = primary_campus_contact()
        assert contact is not None
        self.assertEqual(contact.address, "1 Main St, Lahore, PK")
        self.assertEqual((contact.phone, contact.email), ("+92 300 1", "hello@school.test"))

    def test_no_primary_campus_is_none(self) -> None:
        CampusFactory(tenant=self.tenant)
        self.assertIsNone(primary_campus_contact())

    def test_format_address_uses_known_keys_only(self) -> None:
        self.assertEqual(format_address(None), "")
        self.assertEqual(format_address("Plot 4"), "")
        self.assertEqual(format_address({"notes": "gate code 1234"}), "")
        self.assertEqual(
            format_address({"notes": "gate code 1234", "city": " Lahore ", "line1": "1 Main"}),
            "1 Main, Lahore",
        )

    def test_public_queries_are_constant(self) -> None:
        for level in range(1, 6):
            DepartmentFactory(tenant=self.tenant, show_on_website=True)
            ClassFactory(tenant=self.tenant, level=level, show_on_website=True)
        CampusFactory(tenant=self.tenant, is_primary=True)
        with self.assertNumQueries(1):
            self.assertEqual(len(public_departments()), 5)
        with self.assertNumQueries(1):
            self.assertEqual(len(public_classes()), 5)
        with self.assertNumQueries(1):
            self.assertIsNotNone(primary_campus_contact())
        self.assertEqual(Campus.objects.filter(is_primary=True).count(), 1)
