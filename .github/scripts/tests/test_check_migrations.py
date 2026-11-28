"""Tests for .github/scripts/check_migrations.py, run by repo-hygiene.yml (deploy-scripts).

Fixtures are real migration source strings; Django is never imported.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".github" / "scripts"))
import check_migrations as cm  # its directory is put on sys.path just above

APP = "apps/api/apps/fees/migrations"
PATH = f"{APP}/0002_change.py"

# The deployed 0001_initial: the prior definitions AlterField is compared with.
BASE_INITIAL = textwrap.dedent(
    """
    from django.db import migrations, models

    LIMIT = 50

    class Migration(migrations.Migration):
        initial = True
        operations = [
            migrations.CreateModel(
                name="Invoice",
                fields=[
                    ("id", models.UUIDField(primary_key=True)),
                    ("title", models.CharField(max_length=100)),
                    ("note", models.CharField(max_length=50, null=True)),
                    ("amount", models.DecimalField(max_digits=7, decimal_places=2)),
                    ("code", models.CharField(max_length=50)),
                    ("status", models.CharField(max_length=20, choices=[("a", "A")])),
                ],
                options={"db_table": "fees_ledger"},
            ),
            migrations.CreateModel(name="Term", fields=[("id", models.UUIDField(primary_key=True))]),
        ]
    """
)


def migration(*operations: str, header: str = "") -> str:
    body = ",\n        ".join(operations)
    return (
        "from django.db import migrations, models\n"
        "from core.tenancy.rls import rls_operations\n"
        "from core.tenancy.grants import append_only_operations\n"
        f"{header}\n"
        "class Migration(migrations.Migration):\n"
        "    operations = [\n"
        f"        {body},\n"
        "    ]\n"
    )


def prior() -> dict[cm.FieldKey, object]:
    return cm.prior_definitions([(f"{APP}/0001_initial.py", BASE_INITIAL)])


def classify(source: str, new_sources: list[tuple[str, str]] | None = None) -> list[cm.Finding]:
    added = [(PATH, source), *(new_sources or [])]
    return cm.classify_source(
        source,
        PATH,
        prior(),
        cm.defined_fields(added),
        frozenset(cm.created_tables(added)),
    )


def severities(findings: list[cm.Finding]) -> set[str]:
    return {f.severity for f in findings}


ALTER = 'migrations.AlterField(model_name="invoice", name="{name}", field={field})'
CREATE_T1 = migration(
    'migrations.CreateModel(name="T1", fields=[("id", models.UUIDField(primary_key=True))], '
    'options={"db_table": "academics_t1"})'
)
CREATE_LEDGER = migration(
    'migrations.CreateModel(name="Ledger", fields=[("id", models.UUIDField(primary_key=True))], '
    'options={"db_table": "fees_ledger_v2"})'
)


class ContractTests(unittest.TestCase):
    def assertContract(self, source: str) -> None:
        self.assertIn("contract", severities(classify(source)), source)

    def test_remove_field_is_contract(self) -> None:
        self.assertContract(migration('migrations.RemoveField(model_name="invoice", name="note")'))

    def test_delete_model_is_contract(self) -> None:
        self.assertContract(migration('migrations.DeleteModel(name="Term")'))

    def test_rename_field_is_contract(self) -> None:
        self.assertContract(
            migration('migrations.RenameField(model_name="invoice", old_name="a", new_name="b")')
        )

    def test_rename_model_is_contract(self) -> None:
        self.assertContract(migration('migrations.RenameModel(old_name="Term", new_name="Period")'))

    def test_remove_constraint_is_contract(self) -> None:
        self.assertContract(migration('migrations.RemoveConstraint(model_name="invoice", name="c")'))

    def test_alter_model_table_is_contract(self) -> None:
        self.assertContract(migration('migrations.AlterModelTable(name="invoice", table="x")'))

    def test_add_not_null_field_with_python_default_is_contract(self) -> None:
        self.assertContract(migration(
            'migrations.AddField(model_name="invoice", name="ref", '
            'field=models.CharField(max_length=10, default="x"))'
        ))

    def test_add_not_null_foreign_key_is_contract(self) -> None:
        self.assertContract(migration(
            'migrations.AddField(model_name="invoice", name="term", '
            'field=models.ForeignKey(on_delete=models.PROTECT, to="fees.term"))'
        ))

    def test_alter_field_setting_not_null_is_contract(self) -> None:
        self.assertContract(migration(ALTER.format(name="note", field="models.CharField(max_length=50)")))

    def test_alter_field_narrowing_max_length_is_contract(self) -> None:
        self.assertContract(migration(ALTER.format(name="title", field="models.CharField(max_length=50)")))

    def test_alter_field_type_change_is_contract(self) -> None:
        self.assertContract(migration(ALTER.format(name="title", field="models.IntegerField()")))

    def test_alter_field_narrowing_max_digits_is_contract(self) -> None:
        self.assertContract(migration(ALTER.format(
            name="amount", field="models.DecimalField(max_digits=5, decimal_places=2)"
        )))

    def test_alter_field_adding_db_column_is_contract(self) -> None:
        self.assertContract(migration(ALTER.format(
            name="title", field='models.CharField(max_length=100, db_column="x")'
        )))

    def test_run_sql_drop_table_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("DROP TABLE x")'))

    def test_run_sql_policy_recreation_has_no_carve_out(self) -> None:
        self.assertContract(migration(
            'migrations.RunSQL("DROP POLICY IF EXISTS p ON t; CREATE POLICY p ON t USING (true)")'
        ))

    def test_run_sql_type_change_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("ALTER TABLE x ALTER COLUMN y TYPE int")'))

    def test_run_sql_set_not_null_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("ALTER TABLE x ALTER COLUMN y SET NOT NULL")'))

    def test_run_sql_disable_rls_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("ALTER TABLE x DISABLE ROW LEVEL SECURITY")'))

    def test_run_sql_no_force_rls_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("ALTER TABLE x NO FORCE ROW LEVEL SECURITY")'))

    def test_run_sql_delete_from_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("DELETE FROM x")'))

    def test_run_sql_update_set_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("UPDATE x SET y = 1")'))

    def test_run_sql_rename_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL("ALTER TABLE x RENAME TO y")'))

    def test_run_sql_list_with_drop_in_second_element_is_contract(self) -> None:
        self.assertContract(migration('migrations.RunSQL(["SELECT 1", "DROP TABLE x"])'))

    def test_run_sql_module_constant_is_resolved(self) -> None:
        self.assertContract(migration("migrations.RunSQL(SQL)", header='SQL = "DROP TABLE x"'))
        self.assertContract(migration("migrations.RunSQL(sql=SQL)", header='SQL = "DROP TABLE x"'))

    def test_separate_database_and_state_database_half_is_scanned(self) -> None:
        self.assertContract(migration(
            "migrations.SeparateDatabaseAndState(database_operations=["
            'migrations.RemoveField(model_name="invoice", name="note")], state_operations=[])'
        ))

    def test_syntax_error_is_contract(self) -> None:
        findings = classify("class Migration(:\n")
        self.assertEqual(severities(findings), {"contract"})


class ReviewTests(unittest.TestCase):
    def assertReviewOnly(self, source: str, extra: list[tuple[str, str]] | None = None) -> None:
        self.assertEqual(severities(classify(source, extra)), {"review"}, source)

    def test_alter_field_with_no_prior_definition_is_review(self) -> None:
        self.assertReviewOnly(migration(
            'migrations.AlterField(model_name="unknown", name="x", field=models.IntegerField())'
        ))

    def test_alter_field_non_literal_max_length_is_review(self) -> None:
        self.assertReviewOnly(migration(ALTER.format(name="code", field="models.CharField(max_length=LIMIT)")))

    def test_add_field_non_literal_null_is_review(self) -> None:
        self.assertReviewOnly(migration(
            'migrations.AddField(model_name="invoice", name="x", field=models.IntegerField(null=NULLABLE))'
        ))

    def test_run_python_is_review(self) -> None:
        self.assertReviewOnly(migration("migrations.RunPython(forwards, backwards)"))

    def test_run_sql_f_string_is_review(self) -> None:
        self.assertReviewOnly(migration('migrations.RunSQL(f"SELECT {x}")'))

    def test_unlisted_helper_is_review(self) -> None:
        self.assertReviewOnly(migration("*some_helper()"))

    def test_rls_on_existing_table_is_review(self) -> None:
        self.assertReviewOnly(migration('*rls_operations("academics_t1")'))

    def test_append_only_on_existing_table_is_review(self) -> None:
        self.assertReviewOnly(migration('*append_only_operations("fees_ledger")'))

    def test_rls_with_non_literal_argument_is_review(self) -> None:
        self.assertReviewOnly(migration("*rls_operations(TABLES)"), [(f"{APP}/0003_t1.py", CREATE_T1)])

    def test_unknown_operation_is_review(self) -> None:
        self.assertReviewOnly(migration("migrations.AlterSomethingNew()"))


class CleanTests(unittest.TestCase):
    def assertClean(self, source: str, extra: list[tuple[str, str]] | None = None) -> None:
        self.assertEqual(classify(source, extra), [], source)

    def test_create_model_is_clean(self) -> None:
        self.assertClean(CREATE_T1)

    def test_nullable_add_field_is_clean(self) -> None:
        self.assertClean(migration(
            'migrations.AddField(model_name="invoice", name="x", field=models.IntegerField(null=True))'
        ))

    def test_not_null_add_field_with_db_default_is_clean(self) -> None:
        self.assertClean(migration(
            'migrations.AddField(model_name="invoice", name="x", field=models.IntegerField(db_default=0))'
        ))

    def test_add_index_and_constraint_are_clean(self) -> None:
        self.assertClean(migration(
            'migrations.AddIndex(model_name="invoice", index=models.Index(fields=["code"], name="i"))',
            'migrations.AddConstraint(model_name="invoice", constraint=models.UniqueConstraint(fields=["code"], name="u"))',
        ))

    def test_alter_field_changing_only_choices_is_clean(self) -> None:
        self.assertClean(migration(ALTER.format(
            name="status", field='models.CharField(max_length=20, choices=[("a", "A"), ("b", "B")])'
        )))

    def test_alter_field_widening_max_length_is_clean(self) -> None:
        self.assertClean(migration(ALTER.format(name="code", field="models.CharField(max_length=100)")))

    def test_alter_field_making_nullable_is_clean(self) -> None:
        self.assertClean(migration(ALTER.format(name="code", field="models.CharField(max_length=50, null=True)")))

    def test_alter_field_on_field_added_this_release_is_clean(self) -> None:
        added = migration(
            'migrations.AddField(model_name="invoice", name="fresh", field=models.CharField(max_length=9, null=True))'
        )
        self.assertClean(
            migration(ALTER.format(name="fresh", field="models.CharField(max_length=5)")),
            [(f"{APP}/0001a_fresh.py", added)],
        )

    def test_helpers_on_tables_created_this_release_are_clean(self) -> None:
        self.assertClean(
            migration('*rls_operations("academics_t1")', '*append_only_operations("fees_ledger_v2")'),
            [(f"{APP}/0003_t1.py", CREATE_T1), (f"{APP}/0004_ledger.py", CREATE_LEDGER)],
        )

    def test_append_only_with_literal_mutable_columns_on_new_table_is_clean(self) -> None:
        self.assertClean(
            migration(
                '*append_only_operations("fees_ledger_v2", '
                'mutable_columns={"fees_ledger_v2": ["superseded_by_id"]})'
            ),
            [(f"{APP}/0004_ledger.py", CREATE_LEDGER)],
        )

    def test_reverse_sql_drop_is_clean(self) -> None:
        self.assertClean(migration('migrations.RunSQL(sql="CREATE INDEX i ON t (c)", reverse_sql="DROP INDEX i")'))

    def test_drop_not_null_is_clean(self) -> None:
        self.assertClean(migration('migrations.RunSQL("ALTER TABLE t ALTER COLUMN y DROP NOT NULL")'))

    def test_grant_update_is_clean(self) -> None:
        self.assertClean(migration('migrations.RunSQL("GRANT UPDATE (c) ON t TO r")'))

    def test_on_update_cascade_is_clean(self) -> None:
        self.assertClean(migration(
            'migrations.RunSQL("ALTER TABLE t ADD CONSTRAINT c FOREIGN KEY (a) REFERENCES b ON UPDATE CASCADE")'
        ))

    def test_remove_field_only_in_state_operations_is_clean(self) -> None:
        self.assertClean(migration(
            "migrations.SeparateDatabaseAndState(database_operations=[], state_operations=["
            'migrations.RemoveField(model_name="invoice", name="note")])'
        ))

    def test_drop_inside_a_comment_is_clean(self) -> None:
        self.assertClean(migration('migrations.RunSQL("SELECT 1; -- DROP TABLE x")'))

    def test_drop_inside_a_string_literal_is_clean(self) -> None:
        self.assertClean(migration("migrations.RunSQL(\"COMMENT ON TABLE t IS 'DROP me'\")"))


def _git(repo: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
        "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
    }
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env
    ).stdout.strip()


class MainTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        _git(self.repo, "init", "-q", "-b", "main")
        (self.repo / APP).mkdir(parents=True)
        (self.repo / APP / "0001_initial.py").write_text(BASE_INITIAL)
        _git(self.repo, "add", ".")
        _git(self.repo, "commit", "-q", "-m", "base")
        self.base = _git(self.repo, "rev-parse", "HEAD")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def target(self, source: str) -> str:
        (self.repo / PATH).write_text(source)
        _git(self.repo, "add", ".")
        _git(self.repo, "commit", "-q", "-m", "target")
        return _git(self.repo, "rev-parse", "HEAD")

    def run_main(self, *args: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cm.main(["check_migrations.py", "--repo", str(self.repo), *args])
        return code, out.getvalue()

    def test_nullable_add_field_exits_0(self) -> None:
        sha = self.target(migration(
            'migrations.AddField(model_name="invoice", name="x", field=models.IntegerField(null=True))'
        ))
        self.assertEqual(self.run_main("--base", self.base, "--target", sha)[0], 0)

    def test_remove_field_exits_1_and_allow_contract_exits_0(self) -> None:
        sha = self.target(migration('migrations.RemoveField(model_name="invoice", name="note")'))
        self.assertEqual(self.run_main("--base", self.base, "--target", sha)[0], 1)
        code, out = self.run_main("--base", self.base, "--target", sha, "--allow-contract")
        self.assertEqual(code, 0)
        self.assertIn("overridden by --allow-contract", out)

    def test_run_python_exits_4_and_acknowledge_review_exits_0(self) -> None:
        sha = self.target(migration("migrations.RunPython(forwards)"))
        self.assertEqual(self.run_main("--base", self.base, "--target", sha)[0], 4)
        self.assertEqual(
            self.run_main("--base", self.base, "--target", sha, "--acknowledge-review")[0], 0
        )

    def test_base_none_exits_0(self) -> None:
        sha = self.target(migration('migrations.RemoveField(model_name="invoice", name="note")'))
        code, out = self.run_main("--base", "none", "--target", sha)
        self.assertEqual(code, 0)
        self.assertIn("first deploy", out)

    def test_unknown_base_exits_2(self) -> None:
        sha = self.target(migration("migrations.RunPython(forwards)"))
        self.assertEqual(self.run_main("--base", "0" * 40, "--target", sha)[0], 2)

    def test_edited_migration_is_review(self) -> None:
        (self.repo / APP / "0001_initial.py").write_text(BASE_INITIAL + "\n# edited\n")
        sha = self.target(migration("migrations.AddIndex(model_name='invoice', index=None)"))
        self.assertEqual(self.run_main("--base", self.base, "--target", sha)[0], 4)

    def test_deleted_migration_is_contract(self) -> None:
        (self.repo / APP / "0001_initial.py").unlink()
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "delete")
        sha = _git(self.repo, "rev-parse", "HEAD")
        self.assertEqual(self.run_main("--base", self.base, "--target", sha)[0], 1)

    def test_json_records_every_finding_with_overridden(self) -> None:
        sha = self.target(migration('migrations.RemoveField(model_name="invoice", name="note")'))
        out = self.repo / "findings.json"
        self.run_main("--base", self.base, "--target", sha, "--allow-contract", "--json", str(out))
        findings = json.loads(out.read_text())["findings"]
        self.assertEqual([(f["severity"], f["overridden"]) for f in findings], [("contract", True)])


if __name__ == "__main__":
    unittest.main()
