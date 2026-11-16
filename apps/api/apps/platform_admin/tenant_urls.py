"""This module's tenant-facing routes, mounted at ``/api/v1/`` by config/api_v1.py.

Separate from `urls.py` (the console, under ``/platform/``, platform users only): a school's
own staff call these with tenant RBAC (ruling A6).
"""

from django.urls import path

from apps.platform_admin.onboarding.view import OnboardingView

urlpatterns = [
    path("onboarding", OnboardingView.as_view(), name="onboarding"),
]
