"""Routes for `/holiday-calendar` (module doc §16)."""

from __future__ import annotations

from django.urls import path

from apps.school_organization.holiday_calendar.view import HolidayCalendarView

urlpatterns = [
    path("holiday-calendar", HolidayCalendarView.as_view(), name="holiday-calendar"),
]
