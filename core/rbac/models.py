"""Authentication and RBAC models.

Model: users hold roles, roles hold permissions, permissions are static code-defined
keys of the form ``module.resource.action``. There is no direct user→permission grant
and no role inheritance — composition only.

See schoolhub-srd/docs/02-architecture/auth-and-rbac.md.
"""

import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

from core.tenancy.managers import AllTenantsManager
from core.tenancy.models import TimestampedModel


class RecordScope(models.TextChoices):
    """Record-level constraint attached to a user's role assignment."""

    OWN = "own", "Own records only"
    ASSIGNED = "assigned", "Assigned classes/sections/subjects"
    CAMPUS = "campus", "One campus"
    ALL = "all", "Whole tenant"


class UserManager(BaseUserManager):
    """Manager for the custom user model.

    Deliberately unfiltered: authentication must find the user *before* a tenant
    context exists, so tenant scoping is applied by the middleware and RLS, not here.
    """

    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Users must have an email address.")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_platform", True)
        extra.setdefault("is_active", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin, TimestampedModel):
    """A principal. Belongs to exactly one tenant, or to the platform scope.

    ``tenant`` is nullable because platform staff have no tenant; every tenant
    member has it set and the middleware derives the RLS context from it.
    """

    email = models.EmailField(max_length=254)
    # NULL rather than "" is load-bearing: the partial unique index below treats
    # every NULL as distinct, so many users can lack a username while the ones that
    # have it stay unique per tenant.
    username = models.CharField(  # noqa: DJ001
        max_length=150,
        null=True,
        blank=True,
        help_text="School-issued login for students without email.",
    )
    tenant = models.ForeignKey(
        "tenancy.Tenant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="users",
    )
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text="Django admin access only.")
    is_platform = models.BooleanField(
        default=False, help_text="Platform-scope principal (no tenant)."
    )
    mfa_enabled = models.BooleanField(default=False)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "users"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "email"],
                name="users_unique_email_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["tenant", "username"],
                name="users_unique_username_per_tenant",
                condition=models.Q(deleted_at__isnull=True, username__isnull=False),
            ),
            # A principal is either platform-scope or tenant-scoped, never both/neither.
            models.CheckConstraint(
                condition=(
                    models.Q(is_platform=True, tenant__isnull=True)
                    | models.Q(is_platform=False, tenant__isnull=False)
                ),
                name="users_platform_xor_tenant",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "is_active"])]

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email


class Permission(models.Model):
    """A static permission key. Platform-scope: seeded by migrations, never tenant-editable."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=120, unique=True, help_text="module.resource.action")
    module = models.CharField(max_length=40, db_index=True)
    resource = models.CharField(max_length=60)
    action = models.CharField(max_length=30)
    description = models.CharField(max_length=255, blank=True)

    objects = models.Manager()

    class Meta:
        db_table = "permissions"
        ordering = ["module", "resource", "action"]

    def __str__(self) -> str:
        return self.key


class Role(TimestampedModel):
    """A named set of permissions.

    Default roles are platform-seeded and shared (``tenant`` is null); custom roles
    are tenant-created. Hence tenant is nullable and this model does not extend
    TenantOwnedModel.
    """

    tenant = models.ForeignKey(
        "tenancy.Tenant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="roles",
        help_text="Null for platform-seeded default roles.",
    )
    slug = models.SlugField(max_length=60)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True)
    is_default = models.BooleanField(default=False, help_text="Platform-seeded, not deletable.")
    is_restricted_principal = models.BooleanField(
        default=False,
        help_text="Student/guardian role: can never hold staff permission keys.",
    )
    permissions = models.ManyToManyField(
        Permission, through="RolePermission", related_name="roles"
    )

    objects = AllTenantsManager()

    class Meta:
        db_table = "roles"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "slug"],
                name="roles_unique_slug_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.slug}{'' if self.tenant_id else ' (default)'}"


class RolePermission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE)
    granted_at = models.DateTimeField(auto_now_add=True)

    objects = models.Manager()

    class Meta:
        db_table = "role_permissions"
        constraints = [
            models.UniqueConstraint(fields=["role", "permission"], name="role_permission_unique"),
        ]

    def __str__(self) -> str:
        return f"{self.role_id} -> {self.permission_id}"


class UserRole(TimestampedModel):
    """Assignment of a role to a user, optionally narrowed by a record scope."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="user_roles")
    tenant = models.ForeignKey(
        "tenancy.Tenant", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    scope = models.CharField(max_length=20, choices=RecordScope.choices, default=RecordScope.ALL)
    scope_ref = models.UUIDField(
        null=True, blank=True, help_text="Campus id when scope='campus'."
    )

    objects = AllTenantsManager()

    class Meta:
        db_table = "user_roles"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "role", "scope", "scope_ref"],
                name="user_role_unique_assignment",
            ),
        ]
        indexes = [models.Index(fields=["user", "tenant"])]
