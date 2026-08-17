"""Initial schema for the school-organization module.

Ends with rls_operations(...) for every table created here: a tenant-owned table
that ships without a Row-Level Security policy fails tests/test_rls_coverage.py,
because the manager-level tenant filter is defence in depth, not the boundary.
"""

import uuid

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models

from core.tenancy.rls import rls_operations

# Columns every tenant-owned table carries (TimestampedModel + TenantOwnedModel).
# Built fresh per call: a Field instance must not be shared between ModelStates.
def _audit_fields():
    return [
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True,
                                serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
        ("updated_at", models.DateTimeField(auto_now=True)),
        ("created_by", models.UUIDField(blank=True, editable=False, null=True)),
        ("updated_by", models.UUIDField(blank=True, editable=False, null=True)),
        ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
    ]


def _tenant_field():
    return (
        "tenant",
        models.ForeignKey(
            on_delete=django.db.models.deletion.CASCADE,
            related_name="+",
            to="tenancy.tenant",
        ),
    )


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("tenancy", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Campus",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(max_length=150)),
                ("code", models.CharField(max_length=20)),
                ("address", models.JSONField(blank=True, null=True)),
                ("phone", models.CharField(blank=True, max_length=32, null=True)),
                ("email", models.EmailField(blank=True, max_length=254, null=True)),
                ("timezone", models.CharField(
                    blank=True,
                    help_text="IANA identifier. Null inherits the tenant timezone.",
                    max_length=64,
                    null=True,
                )),
                ("head_staff_id", models.UUIDField(
                    blank=True, help_text="staff(id) — campus head.", null=True
                )),
                ("is_primary", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                _tenant_field(),
            ],
            options={
                "db_table": "campuses",
                "ordering": ["name"],
                "verbose_name_plural": "campuses",
            },
        ),
        migrations.CreateModel(
            name="Department",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(max_length=150)),
                ("code", models.CharField(max_length=20)),
                ("department_type", models.CharField(
                    choices=[("academic", "Academic"), ("administrative", "Administrative")],
                    default="academic",
                    max_length=20,
                )),
                ("head_staff_id", models.UUIDField(
                    blank=True, help_text="staff(id) — head of dept.", null=True
                )),
                ("description", models.CharField(blank=True, max_length=300, null=True)),
                ("is_active", models.BooleanField(default=True)),
                ("campus", models.ForeignKey(
                    blank=True,
                    help_text="Null means the department spans every campus.",
                    null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="departments",
                    to="school_organization.campus",
                )),
                _tenant_field(),
            ],
            options={"db_table": "departments", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="AcademicSession",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(
                    help_text='School year label, e.g. "2026–27".', max_length=50
                )),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                ("status", models.CharField(
                    choices=[
                        ("planned", "Planned"),
                        ("active", "Active"),
                        ("closed", "Closed"),
                        ("archived", "Archived"),
                    ],
                    default="planned",
                    max_length=20,
                )),
                ("is_current", models.BooleanField(default=False)),
                _tenant_field(),
            ],
            options={"db_table": "academic_sessions", "ordering": ["-start_date"]},
        ),
        migrations.CreateModel(
            name="Term",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(max_length=50)),
                ("sequence", models.PositiveSmallIntegerField(
                    help_text="Order within the session, 1-based."
                )),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                ("academic_session", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="terms",
                    to="school_organization.academicsession",
                )),
                _tenant_field(),
            ],
            options={"db_table": "terms", "ordering": ["academic_session_id", "sequence"]},
        ),
        migrations.CreateModel(
            name="Class",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(max_length=80)),
                ("code", models.CharField(blank=True, max_length=20, null=True)),
                ("level", models.PositiveSmallIntegerField(
                    help_text="Promotion ordering; the next level up is the promotion target."
                )),
                ("is_active", models.BooleanField(default=True)),
                _tenant_field(),
            ],
            options={
                "db_table": "classes",
                "ordering": ["level"],
                "verbose_name": "class",
                "verbose_name_plural": "classes",
            },
        ),
        migrations.CreateModel(
            name="Section",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(help_text='Division label, e.g. "A".', max_length=30)),
                ("capacity", models.PositiveSmallIntegerField(
                    blank=True,
                    help_text="Enrollment ceiling. Null means unlimited.",
                    null=True,
                )),
                ("class_teacher_staff_id", models.UUIDField(
                    blank=True, help_text="staff(id) — homeroom teacher.", null=True
                )),
                ("room_id", models.UUIDField(
                    blank=True, help_text="rooms(id) — default homeroom.", null=True
                )),
                ("is_active", models.BooleanField(default=True)),
                ("campus", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="sections",
                    to="school_organization.campus",
                )),
                ("school_class", models.ForeignKey(
                    db_column="class_id",
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="sections",
                    to="school_organization.class",
                )),
                _tenant_field(),
            ],
            options={"db_table": "sections", "ordering": ["school_class_id", "name"]},
        ),
        migrations.CreateModel(
            name="Subject",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(max_length=120)),
                ("code", models.CharField(max_length=20)),
                ("subject_type", models.CharField(
                    choices=[
                        ("core", "Core"),
                        ("elective", "Elective"),
                        ("co_curricular", "Co-curricular"),
                    ],
                    default="core",
                    max_length=20,
                )),
                ("description", models.CharField(blank=True, max_length=300, null=True)),
                ("is_active", models.BooleanField(default=True)),
                ("department", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="subjects",
                    to="school_organization.department",
                )),
                _tenant_field(),
            ],
            options={"db_table": "subjects", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="ClassSubject",
            fields=[
                *_audit_fields(),
                ("is_elective", models.BooleanField(default=False)),
                ("elective_group", models.CharField(
                    blank=True,
                    help_text='Options sharing a group are mutually choosable '
                              '("choose 1 of N").',
                    max_length=50,
                    null=True,
                )),
                ("weekly_periods", models.PositiveSmallIntegerField(
                    default=1,
                    help_text="Target periods per week.",
                    validators=[django.core.validators.MinValueValidator(1)],
                )),
                ("syllabus_file_id", models.UUIDField(
                    blank=True, help_text="files(id).", null=True
                )),
                ("term_plans", models.JSONField(
                    blank=True,
                    help_text="[{term_id, topics: [...]}] per-term topic plan.",
                    null=True,
                )),
                ("notes", models.CharField(blank=True, max_length=500, null=True)),
                ("academic_session", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="class_subjects",
                    to="school_organization.academicsession",
                )),
                ("campus", models.ForeignKey(
                    blank=True,
                    help_text="Null means the mapping applies to every campus.",
                    null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="class_subjects",
                    to="school_organization.campus",
                )),
                ("school_class", models.ForeignKey(
                    db_column="class_id",
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="class_subjects",
                    to="school_organization.class",
                )),
                ("subject", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="class_subjects",
                    to="school_organization.subject",
                )),
                _tenant_field(),
            ],
            options={
                "db_table": "class_subjects",
                "ordering": ["academic_session_id", "school_class_id", "subject_id"],
            },
        ),
        migrations.CreateModel(
            name="House",
            fields=[
                *_audit_fields(),
                ("name", models.CharField(max_length=80)),
                ("code", models.CharField(blank=True, max_length=20, null=True)),
                ("color", models.CharField(
                    blank=True, help_text="Token or hex.", max_length=20, null=True
                )),
                ("motto", models.CharField(blank=True, max_length=200, null=True)),
                ("house_master_staff_id", models.UUIDField(
                    blank=True, help_text="staff(id).", null=True
                )),
                ("is_active", models.BooleanField(default=True)),
                _tenant_field(),
            ],
            options={"db_table": "houses", "ordering": ["name"]},
        ),
        migrations.AddConstraint(
            model_name="campus",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "code"),
                name="campuses_unique_code_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="campus",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_primary", True), ("deleted_at__isnull", True)),
                fields=("tenant",),
                name="campuses_one_primary_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="department",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "code"),
                name="departments_unique_code_per_tenant",
            ),
        ),
        migrations.AddIndex(
            model_name="department",
            index=models.Index(
                fields=["tenant", "campus"], name="departments_tenant_campus_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="department",
            index=models.Index(
                fields=["tenant", "department_type"], name="departments_tenant_type_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="academicsession",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "name"),
                name="sessions_unique_name_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="academicsession",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_current", True), ("deleted_at__isnull", True)),
                fields=("tenant",),
                name="sessions_one_current_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="academicsession",
            constraint=models.CheckConstraint(
                condition=models.Q(("end_date__gt", models.F("start_date"))),
                name="sessions_end_after_start",
            ),
        ),
        migrations.AddIndex(
            model_name="academicsession",
            index=models.Index(
                fields=["tenant", "status"], name="sessions_tenant_status_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="term",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "academic_session", "name"),
                name="terms_unique_name_per_session",
            ),
        ),
        migrations.AddConstraint(
            model_name="term",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "academic_session", "sequence"),
                name="terms_unique_sequence_per_session",
            ),
        ),
        migrations.AddConstraint(
            model_name="term",
            constraint=models.CheckConstraint(
                condition=models.Q(("end_date__gt", models.F("start_date"))),
                name="terms_end_after_start",
            ),
        ),
        migrations.AddConstraint(
            model_name="class",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "name"),
                name="classes_unique_name_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="class",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "level"),
                name="classes_unique_level_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="class",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True), ("code__isnull", False)),
                fields=("tenant", "code"),
                name="classes_unique_code_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="section",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "school_class", "campus", "name"),
                name="sections_unique_name_per_class_campus",
            ),
        ),
        migrations.AddIndex(
            model_name="section",
            index=models.Index(
                fields=["tenant", "campus"], name="sections_tenant_campus_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="section",
            index=models.Index(
                fields=["tenant", "class_teacher_staff_id"], name="sections_class_teacher_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="subject",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "name"),
                name="subjects_unique_name_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="subject",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "code"),
                name="subjects_unique_code_per_tenant",
            ),
        ),
        migrations.AddIndex(
            model_name="subject",
            index=models.Index(
                fields=["tenant", "department"], name="subjects_tenant_dept_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="classsubject",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "academic_session", "school_class", "subject", "campus"),
                name="class_subjects_unique_mapping",
                nulls_distinct=False,
            ),
        ),
        migrations.AddConstraint(
            model_name="classsubject",
            constraint=models.CheckConstraint(
                condition=models.Q(("weekly_periods__gte", 1)),
                name="class_subjects_weekly_periods_positive",
            ),
        ),
        migrations.AddIndex(
            model_name="classsubject",
            index=models.Index(
                fields=["tenant", "academic_session", "school_class"],
                name="class_subjects_session_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="classsubject",
            index=models.Index(
                fields=["tenant", "subject"], name="class_subjects_subject_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="house",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("tenant", "name"),
                name="houses_unique_name_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="house",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True), ("code__isnull", False)),
                fields=("tenant", "code"),
                name="houses_unique_code_per_tenant",
            ),
        ),
        *rls_operations(
            "campuses",
            "departments",
            "academic_sessions",
            "terms",
            "classes",
            "sections",
            "subjects",
            "class_subjects",
            "houses",
        ),
    ]
