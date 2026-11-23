"""Route of the billing webhook (platform-admin.md §16), mounted under `platform/`.

`non_atomic_requests`: a refused signature must keep its security event, and the event is
applied in a transaction `services.handle_event` opens itself.
"""

from django.db import transaction
from django.urls import path

from apps.platform_admin.billing.view import BillingEventView

urlpatterns = [
    path(
        "billing-events/<str:provider>",
        transaction.non_atomic_requests(BillingEventView.as_view()),
        name="platform-billing-events",
    ),
]
