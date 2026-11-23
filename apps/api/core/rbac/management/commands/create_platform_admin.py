"""Create a platform console operator: ``create_platform_admin --email ... --first-name ...``.

The only way a platform user comes to exist (ADR-0036): nobody signs up for the console. The
password is prompted for, never passed as an argument, so it stays out of shell history and
process listings. The account starts with ``mfa_enabled=False``; the console forces TOTP
enrolment at its first sign-in.

``create_platform_admin --email ... --reset-mfa`` is the recovery path for an operator who lost
both their authenticator and their recovery codes: it turns MFA off, forgets the secret and
codes, and ends every session, so the next sign-in enrols again. A platform user can never
turn MFA off through the API (``/auth/mfa:disable`` refuses), so this needs shell access.

``create_platform_admin --email ... --unlock-mfa`` lifts a second-factor lockout, including the
one ``MFA_PERMANENT_LOCKOUT_ATTEMPTS`` wrong codes leave, and keeps the enrolled factor and
recovery codes. Use it once the operator confirms the failures were theirs; if not, the
factor may be compromised and ``--reset-mfa`` is the right call.
"""

from __future__ import annotations

from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import QuerySet

from core.audit.services import record_task_security_event
from core.rbac import mfa
from core.rbac.models import Role, User, UserRole
from core.rbac.roles import PLATFORM_ROLES
from core.rbac.sessions import revoke_refresh_tokens
from core.rbac.sync import sync_default_roles


def _platform_users(email: str) -> QuerySet[User]:
    return User.objects.filter(
        tenant__isnull=True, is_platform=True, email__iexact=email, deleted_at__isnull=True
    )


class Command(BaseCommand):
    help = (
        "Create a platform console user holding one platform role (prompts for the password), "
        "or reset one's MFA with --reset-mfa, or lift an MFA lockout with --unlock-mfa."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("--email", required=True)
        parser.add_argument("--first-name", help="Required when creating a user.")
        parser.add_argument("--last-name", default="")
        parser.add_argument("--role", choices=PLATFORM_ROLES, default="platform_super_admin")
        parser.add_argument(
            "--reset-mfa",
            action="store_true",
            help="Turn MFA off for an existing platform user and end their sessions.",
        )
        parser.add_argument(
            "--unlock-mfa",
            action="store_true",
            help="Lift a platform user's MFA lockout, keeping their enrolled factor.",
        )

    def handle(self, *args, **options) -> None:
        email = User.objects.normalize_email(options["email"].strip())
        if options["reset_mfa"] and options["unlock_mfa"]:
            raise CommandError("Pass one of --reset-mfa and --unlock-mfa.")
        if options["reset_mfa"]:
            self._reset_mfa(email)
            return
        if options["unlock_mfa"]:
            self._unlock_mfa(email)
            return
        if not options["first_name"]:
            raise CommandError("--first-name is required when creating a platform user.")
        self._create(email, options)

    def _reset_mfa(self, email: str) -> None:
        user = _platform_users(email).first()
        if user is None:
            raise CommandError(f"No platform user has the email {email}.")
        with transaction.atomic():
            mfa.reset(user)
            # A refresh token minted after the old factor still carries "otp" in its amr.
            revoke_refresh_tokens(user.pk)
        record_task_security_event("auth.mfa.reset", tenant_id=None, resource_id=user.pk)
        self.stdout.write(
            self.style.SUCCESS(
                f"Reset MFA for {user.email} and ended their sessions. "
                "They enrol a new authenticator at their next sign-in."
            )
        )

    def _unlock_mfa(self, email: str) -> None:
        user = _platform_users(email).first()
        if user is None:
            raise CommandError(f"No platform user has the email {email}.")
        mfa.unlock(user)
        record_task_security_event("auth.mfa.unlocked", tenant_id=None, resource_id=user.pk)
        self.stdout.write(
            self.style.SUCCESS(
                f"Lifted the MFA lockout for {user.email}. Their factor is unchanged."
            )
        )

    def _create(self, email: str, options: dict) -> None:
        if _platform_users(email).exists():
            raise CommandError(f"A platform user with the email {email} already exists.")

        password = getpass("Password: ")
        if getpass("Password (again): ") != password:
            raise CommandError("The passwords do not match.")
        candidate = User(email=email, first_name=options["first_name"], is_platform=True)
        try:
            validate_password(password, user=candidate)
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from error

        with transaction.atomic():
            # The default roles exist after any migrate; this covers a database where the
            # post_migrate sync has not run since the platform roles shipped.
            sync_default_roles()
            role = Role.objects.get(tenant=None, slug=options["role"], deleted_at__isnull=True)
            user = User.objects.create_user(
                email,
                password,
                tenant=None,
                is_platform=True,
                is_active=True,
                mfa_enabled=False,
                first_name=options["first_name"],
                last_name=options["last_name"],
            )
            UserRole.objects.create(user=user, role=role)

        self.stdout.write(
            self.style.SUCCESS(
                f"Created {options['role']} {email}. TOTP enrolment is required at first sign-in."
            )
        )
