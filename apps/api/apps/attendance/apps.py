from django.apps import AppConfig


class AttendanceConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.attendance"
    label = "attendance"
    verbose_name = "Attendance"

    def ready(self) -> None:
        from apps.attendance.services import timetable_disable_refusal
        from core.tenancy.features import register_disable_guard

        # Period mode reads the timetable, so the console may not switch it off (ADR-0013:
        # core asks through the guard, it never imports this app).
        register_disable_guard("module.timetable", timetable_disable_refusal)
