"""Platform scope (ADR-0036): scoped permission keys, platform roles, and a trigger that keeps
a role's scope equal to its holder's.

The scope column defaults to ``tenant``; the ``post_migrate`` sync then writes each key's real
scope from the registry, as it writes every other column.
"""

from django.db import migrations, models

# A role assignment's role and user agree on platform scope. A trigger rather than an
# application check, so a `bulk_create` (staff `:invite` uses one) cannot bypass it.
USER_ROLES_SCOPE_TRIGGER = """
CREATE FUNCTION user_roles_match_principal_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT is_platform FROM users WHERE id = NEW.user_id)
       IS DISTINCT FROM (SELECT is_platform FROM roles WHERE id = NEW.role_id) THEN
        RAISE EXCEPTION 'role % and user % differ in platform scope', NEW.role_id, NEW.user_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER user_roles_match_principal_scope
    BEFORE INSERT OR UPDATE OF user_id, role_id ON user_roles
    FOR EACH ROW EXECUTE FUNCTION user_roles_match_principal_scope();
"""

DROP_USER_ROLES_SCOPE_TRIGGER = """
DROP TRIGGER IF EXISTS user_roles_match_principal_scope ON user_roles;
DROP FUNCTION IF EXISTS user_roles_match_principal_scope();
"""


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0002_invitations'),
        ('tenancy', '0009_tenantsettings_logo_file'),
    ]

    operations = [
        migrations.AddField(
            model_name='permission',
            name='scope',
            field=models.CharField(choices=[('tenant', 'Tenant'), ('platform', 'Platform')], db_default='tenant', default='tenant', max_length=10),
        ),
        migrations.AddField(
            model_name='role',
            name='is_platform',
            field=models.BooleanField(db_default=False, default=False, help_text='Platform role: holds platform-scope keys, held by platform users only.'),
        ),
        # Shared default roles have no tenant; NULLS NOT DISTINCT makes their slugs unique.
        migrations.RemoveConstraint(
            model_name='role',
            name='roles_unique_slug_per_tenant',
        ),
        migrations.AddConstraint(
            model_name='role',
            constraint=models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('tenant', 'slug'), name='roles_unique_slug_per_tenant', nulls_distinct=False),
        ),
        migrations.AddConstraint(
            model_name='role',
            constraint=models.CheckConstraint(condition=models.Q(('is_platform', False), ('tenant__isnull', True), _connector='OR'), name='roles_platform_has_no_tenant'),
        ),
        migrations.RunSQL(sql=USER_ROLES_SCOPE_TRIGGER, reverse_sql=DROP_USER_ROLES_SCOPE_TRIGGER),
    ]
