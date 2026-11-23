"""The module's tenant-facing routes, mounted at ``/api/v1/`` by config/api_v1.py (ruling A6).

Separate from `urls.py` (the console, under ``platform/``): these serve a school's own users
with their own school bound, and the console's platform gate never applies to them.
"""

from django.urls import path

from apps.platform_admin.subscriptions.view import SchoolSubscriptionView

urlpatterns = [
    path("subscription", SchoolSubscriptionView.as_view(), name="school-subscription"),
]
