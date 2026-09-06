"""Pins the wire contract the TypeScript client is generated against.

These exist because the contract silently diverged once already: the backend
returned `next`/`previous` holding absolute URLs while the client read
`next_cursor`/`previous_cursor` expecting bare tokens. Nothing failed — pagination
simply stopped after the first page, in every list in the product.

Serializer-level tests cannot catch that; only the rendered envelope can.
"""

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.api.exceptions import _CODE_BY_STATUS
from core.tenancy.context import tenant_context

# Kept in step with packages/types/src/api.ts by the assertion below.
CLIENT_KNOWN_SERVER_CODES = {
    "validation_error",
    "unauthenticated",
    "permission_denied",
    "not_found",
    "method_not_allowed",
    "conflict",
    "unprocessable",
    "domain_rule_violation",
    "rate_limited",
    "module_disabled",
}


class CursorEnvelopeTests(APITestCase):
    """The cursor envelope, on an endpoint that still uses one.

    Most admin lists moved to page numbers (api-architecture.md §2.4); cursor pagination
    stays the default for everything else, so it still needs pinning. Academic sessions
    are one of the lists that kept it.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        grant(self.user, "school.academic-session.view")
        with tenant_context(self.tenant.id):
            for _ in range(3):
                AcademicSessionFactory(tenant=self.tenant)

    def test_cursor_page_exposes_the_documented_keys(self):
        response = self.client.get("/api/v1/academic-sessions?page_size=2")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pagination = response.json()["meta"]["pagination"]
        self.assertEqual(set(pagination), {"next_cursor", "previous_cursor", "page_size"})

    def test_an_uncounted_endpoint_omits_total_count_rather_than_nulling_it(self):
        """Absent and null mean different things to the client.

        `packages/types` declares `total_count` optional — "only present on endpoints
        cheap enough to count". A null would collapse "this endpoint does not report a
        total" into "the total is unknown", and the dashboard renders those differently.
        """
        pagination = self.client.get("/api/v1/academic-sessions?page_size=2").json()["meta"][
            "pagination"
        ]

        self.assertNotIn("total_count", pagination)

    def test_next_cursor_is_a_token_the_client_can_send_back(self):
        """A URL here would be unusable: the contract is `?cursor=<token>`."""
        first = self.client.get("/api/v1/academic-sessions?page_size=2").json()
        token = first["meta"]["pagination"]["next_cursor"]

        self.assertIsNotNone(token, "three sessions at page_size=2 must paginate")
        self.assertNotIn("://", token, "the cursor must be a token, not a URL")

        second = self.client.get(f"/api/v1/academic-sessions?page_size=2&cursor={token}")

        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(len(second.json()["data"]), 1)
        first_ids = {row["id"] for row in first["data"]}
        second_ids = {row["id"] for row in second.json()["data"]}
        self.assertEqual(first_ids & second_ids, set(), "pages must not overlap")


class OffsetEnvelopeTests(APITestCase):
    """The page-number envelope, which the generated client had wrong until now.

    `PageNumberPagination` overrode `get_paginated_response` but not
    `get_paginated_response_schema`, so openapi.yaml documented DRF's stock
    `{count, next, previous, results}` while the API sent `{data, meta.pagination}`.
    `packages/api-client` is generated from that file, so its type for every
    page-numbered endpoint was wrong. This is the assertion that keeps them in step.
    """

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")
        grant(self.user, "school.campus.view")
        with tenant_context(self.tenant.id):
            for _ in range(3):
                CampusFactory(tenant=self.tenant)

    def test_offset_page_exposes_the_documented_keys(self):
        response = self.client.get("/api/v1/campuses?page_size=2")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pagination = response.json()["meta"]["pagination"]
        self.assertEqual(set(pagination), {"page", "page_size", "total_count", "total_pages"})

    def test_the_total_is_the_whole_set_not_the_page(self):
        pagination = self.client.get("/api/v1/campuses?page_size=2").json()["meta"]["pagination"]

        self.assertEqual(pagination["page"], 1)
        self.assertEqual(pagination["total_count"], 3)
        self.assertEqual(pagination["total_pages"], 2)

    def test_a_page_number_addresses_a_page_directly(self):
        """The reason this pagination exists: a cursor cannot be asked for page 2."""
        second = self.client.get("/api/v1/campuses?page_size=2&page=2")

        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(len(second.json()["data"]), 1)
        self.assertEqual(second.json()["meta"]["pagination"]["page"], 2)


class ErrorCodeContractTests(APITestCase):
    def test_the_client_knows_every_code_the_server_can_emit(self):
        from core.api.exceptions import Conflict, DomainRuleViolation, ModuleDisabled

        emitted = set(_CODE_BY_STATUS.values()) | {
            DomainRuleViolation.default_code,
            Conflict.default_code,
            ModuleDisabled.default_code,
        }
        self.assertEqual(
            emitted - CLIENT_KNOWN_SERVER_CODES,
            set(),
            "codes the server emits that packages/types/src/api.ts does not list",
        )
        self.assertEqual(
            CLIENT_KNOWN_SERVER_CODES - emitted,
            set(),
            "codes the client expects that the server never emits",
        )


class ErrorMetaEnvelopeTests(APITestCase):
    """`error.meta` — structured context that must survive the handler intact.

    `_flatten_details` walks any nested value in `detail` into a flat
    `[{field, issue}]` list. That is right for field errors and destructive for
    anything with shape: a list of objects arrives as one string per leaf, and a
    client keeping the first issue per field name silently drops the rest. The
    timetable publish refusal is the case that surfaced it — it hands back every
    clashing cell so the grid can highlight both sides of a double booking, and
    flattening reduced that to one.

    These pin the envelope itself rather than any one endpoint, because the next
    module to need it (attendance's per-row bulk-mark failures) will reach for
    the same key.
    """

    def render(self, exc):
        from rest_framework.test import APIRequestFactory

        from core.api.exceptions import envelope_exception_handler

        request = APIRequestFactory().post("/api/v1/anything")
        return envelope_exception_handler(exc, {"request": request})

    def test_structured_meta_passes_through_as_json(self):
        from core.api.exceptions import DomainRuleViolation

        payload = {"conflicts": [{"type": "teacher_double_booked", "slot_ids": ["a", "b"]}]}

        response = self.render(DomainRuleViolation({"non_field": "Nope."}, meta=payload))

        self.assertEqual(response.data["error"]["meta"], payload)

    def test_meta_is_absent_when_the_raiser_supplied_none(self):
        """The common envelope is unchanged — this is an optional fifth key, not
        a new required one."""
        from core.api.exceptions import DomainRuleViolation

        response = self.render(DomainRuleViolation({"email": "Already taken."}))

        self.assertNotIn("meta", response.data["error"])

    def test_details_still_flattens_the_human_readable_half(self):
        """`meta` does not replace `details`; a caller with no special handling
        still gets a sentence to show."""
        from core.api.exceptions import DomainRuleViolation

        response = self.render(DomainRuleViolation({"non_field": "Nope."}, meta={"conflicts": []}))

        self.assertEqual(
            response.data["error"]["details"], [{"field": "non_field", "issue": "Nope."}]
        )

    def test_a_plain_drf_error_is_unaffected(self):
        from rest_framework import exceptions

        response = self.render(exceptions.NotFound())

        self.assertNotIn("meta", response.data["error"])
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
