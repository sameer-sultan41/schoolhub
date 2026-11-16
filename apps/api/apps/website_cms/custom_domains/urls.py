"""Routes for `/custom-domains` (module doc §16).

`:verify` is declared before the bare detail route and opts out of ATOMIC_REQUESTS: it looks
DNS up, which must hold no transaction (ADR-0034), so it opens its own around each step.
"""

from django.db import transaction
from django.urls import path

from apps.website_cms.custom_domains.viewset import CustomDomainViewSet

urlpatterns = [
    path(
        "custom-domains",
        CustomDomainViewSet.as_view({"get": "list", "post": "create"}),
        name="custom-domains-list",
    ),
    path(
        "custom-domains/<uuid:pk>:verify",
        transaction.non_atomic_requests(CustomDomainViewSet.as_view({"post": "verify"})),
        name="custom-domains-verify",
    ),
    path(
        "custom-domains/<uuid:pk>",
        CustomDomainViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="custom-domains-detail",
    ),
]
