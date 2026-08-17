"""Append-only audit log.

Immutability is enforced at two levels: this model refuses updates and deletes in
Python, and the migration revokes UPDATE/DELETE on the table from the application
role. See docs/02-architecture/auth-and-rbac.md §4.
"""

import uuid

from django.db import models


class AuditLog(models.Model):
    """One row per mutation. Never updated, never deleted by application code."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        "tenancy.Tenant", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    actor = models.ForeignKey(
        "rbac.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    impersonated_by = models.UUIDField(
        null=True, blank=True, help_text="Platform user acting as the actor, if any."
    )
    action = models.CharField(max_length=40, db_index=True)
    resource_type = models.CharField(max_length=100, db_index=True)
    resource_id = models.UUIDField(null=True, blank=True, db_index=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    request_id = models.CharField(max_length=64, blank=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=400, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    objects = models.Manager()

    class Meta:
        db_table = "audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "-created_at"]),
            models.Index(fields=["resource_type", "resource_id", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.resource_type}:{self.resource_id}"

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise RuntimeError("Audit log entries are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Audit log entries cannot be deleted.")
