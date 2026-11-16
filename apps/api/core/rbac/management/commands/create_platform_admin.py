"""Create a platform console operator: ``create_platform_admin --email ... --first-name ...``.

The only way a platform user comes to exist (ADR-0036): nobody signs up for the console. The
password is prompted for, never passed as an argument, so it stays out of shell history and
process listings. The account starts with ``mfa_enabled=False``; the console forces TOTP
enrolment at its first sign-in.
"""

from __future__ import annotations

from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.rbac.models import Role, User, UserRole
from core.rbac.roles import PLATFORM_ROLES
from core.rbac.sync import sync_default_roles


class Command(BaseCommand):
    help = "Create a platform console user holding one platform role. Prompts for the password."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--email", required=True)
        parser.add_argument("--first-name", required=True)
        parser.add_argument("--last-name", default="")
        parser.add_argument("--role", choices=PLATFORM_ROLES, default="platform_super_admin")

    def handle(self, *args, **options) -> None:
        email = User.objects.normalize_email(options["email"].strip())
        if User.objects.filter(
            tenant__isnull=True, email__iexact=email, deleted_at__isnull=True
        ).exists():
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
