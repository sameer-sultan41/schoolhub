"""Tests for infra/scripts/bootstrap-secrets.sh, run by infra-compose.yml (shellcheck job).

A fake `aws` executable, first on PATH, keeps a JSON "Secrets Manager" in a temp dir and
records every argv, so the script runs end to end without AWS.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "infra" / "scripts" / "bootstrap-secrets.sh"
PREFIX = "schoolhub-staging"

OWNED = [
    "django/secret-key",
    "integrations/encryption-keys",
    "website/machine-tokens",
    "website/machine-token",
    "website/revalidate-secret",
    "db/app-password",
    "db/migrator-password",
    "db/readonly-password",
    "db/app-url",
    "db/migrator-url",
]

# Secret variables whose values come from outside (no generated value, no ARN printed).
EXTERNAL = {"sentry_dsn_arn", "payment_gateway_secret_arn"}

FAKE_AWS = textwrap.dedent(
    r'''
    #!/usr/bin/env python3
    """Fake aws CLI: the secretsmanager calls bootstrap-secrets.sh makes."""
    import json, os, random, string, sys
    from pathlib import Path

    state_dir = Path(os.environ["FAKE_AWS_DIR"])
    db_path = state_dir / "secrets.json"
    db = json.loads(db_path.read_text()) if db_path.exists() else {}
    with (state_dir / "calls.jsonl").open("a") as calls:
        calls.write(json.dumps(sys.argv[1:]) + "\n")

    # Like the real CLI: global options (each "--name value") come before the
    # service and command; command options may take several values (--tags).
    args = sys.argv[1:]
    global_opts, i = {}, 0
    while i < len(args) and args[i].startswith("--"):
        global_opts[args[i]] = args[i + 1]
        i += 2
    service, command = args[i], args[i + 1]
    assert service == "secretsmanager", service
    opts, i = {}, i + 2
    while i < len(args):
        name, values = args[i], []
        i += 1
        while i < len(args) and not args[i].startswith("--"):
            values.append(args[i])
            i += 1
        opts[name] = values
    region = global_opts["--region"]

    def value_of(raw):
        if raw.startswith("file://"):
            return Path(raw[len("file://"):]).read_text()
        return raw

    def err(code, message):
        sys.stderr.write(f"An error occurred ({code}) when calling the operation: {message}\n")
        sys.exit(254)

    def save():
        db_path.write_text(json.dumps(db))

    def secret(name):
        if name not in db:
            err("ResourceNotFoundException", "Secrets Manager can't find the specified secret.")
        return db[name]

    if command == "describe-secret":
        s = secret(opts["--secret-id"][0])
        out = {"ARN": s["arn"], "Name": s["name"]}
        if s.get("deleted"):
            out["DeletedDate"] = "2026-11-01T00:00:00Z"
        if s.get("value") is not None:
            out["VersionIdsToStages"] = {"v1": ["AWSCURRENT"]}
        print(json.dumps(out))
    elif command == "create-secret":
        name = opts["--name"][0]
        if name in db:
            err("ResourceExistsException", "the secret already exists.")
        suffix = "".join(random.choice(string.ascii_letters) for _ in range(6))
        arn = f"arn:aws:secretsmanager:{region}:111111111111:secret:{name}-{suffix}"
        value = value_of(opts["--secret-string"][0]) if "--secret-string" in opts else None
        db[name] = {"name": name, "arn": arn, "value": value, "tags": opts.get("--tags", [])}
        save()
        print(json.dumps({"ARN": arn, "Name": name}))
    elif command == "put-secret-value":
        s = secret(opts["--secret-id"][0])
        s["value"] = value_of(opts["--secret-string"][0])
        save()
        print(json.dumps({"ARN": s["arn"], "VersionId": "v2"}))
    elif command == "get-secret-value":
        s = secret(opts["--secret-id"][0])
        if s.get("value") is None:
            err("ResourceNotFoundException", "no AWSCURRENT version")
        print(json.dumps({"ARN": s["arn"], "SecretString": s["value"]}))
    elif command == "restore-secret":
        s = secret(opts["--secret-id"][0])
        s.pop("deleted", None)
        save()
        print(json.dumps({"ARN": s["arn"]}))
    else:
        err("InvalidRequestException", f"fake aws does not implement {command}")
    '''
).lstrip()


class BootstrapSecretsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        fake = bin_dir / "aws"
        fake.write_text(FAKE_AWS)
        fake.chmod(0o755)
        self.env = {
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "AWS_REGION": "us-east-1",
            "FAKE_AWS_DIR": str(self.dir),
        }

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # -- helpers ---------------------------------------------------------------

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), "--env", "staging", *args],
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def pre_apply(self) -> subprocess.CompletedProcess[str]:
        return self.run_script("--phase", "pre-apply")

    def post_apply(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return self.run_script("--phase", "post-apply", "--db-host", "db.internal", *extra)

    def secrets(self) -> dict[str, dict]:
        path = self.dir / "secrets.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def value(self, short: str) -> str | None:
        return self.secrets()[f"{PREFIX}/{short}"]["value"]

    def seed(self, short: str, value: str | None, **extra: object) -> None:
        db = self.secrets()
        name = f"{PREFIX}/{short}"
        db[name] = {"name": name, "arn": f"arn:fake:{name}-Seeded", "value": value, **extra}
        (self.dir / "secrets.json").write_text(json.dumps(db))

    def calls(self) -> list[list[str]]:
        path = self.dir / "calls.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines()]

    def writes(self) -> list[list[str]]:
        return [c for c in self.calls() if "create-secret" in c or "put-secret-value" in c]

    def reset_calls(self) -> None:
        (self.dir / "calls.jsonl").unlink(missing_ok=True)

    def assert_ok(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, result.stderr)

    # -- pre-apply -------------------------------------------------------------

    def test_pre_apply_creates_every_owned_secret_once(self) -> None:
        self.assert_ok(self.pre_apply())
        db = self.secrets()
        self.assertEqual(sorted(db), sorted(f"{PREFIX}/{s}" for s in OWNED))
        creates = [c for c in self.calls() if "create-secret" in c]
        self.assertEqual(len(creates), len(OWNED))
        self.assertIsNone(self.value("db/app-url"))
        self.assertIsNone(self.value("db/migrator-url"))
        for short in OWNED:
            if not short.endswith("-url"):
                self.assertTrue(self.value(short), short)

    def test_rerun_makes_no_writes(self) -> None:
        self.assert_ok(self.pre_apply())
        self.reset_calls()
        self.assert_ok(self.pre_apply())
        self.assertEqual(self.writes(), [])

        self.assert_ok(self.post_apply())
        self.reset_calls()
        self.assert_ok(self.post_apply())
        self.assertEqual(self.writes(), [])

    def test_existing_value_is_never_overwritten(self) -> None:
        self.seed("django/secret-key", "keep")
        self.assert_ok(self.pre_apply())
        self.assertEqual(self.value("django/secret-key"), "keep")

    def test_machine_token_is_in_token_list(self) -> None:
        self.assert_ok(self.pre_apply())
        tokens = self.value("website/machine-tokens").split(",")
        self.assertIn(self.value("website/machine-token"), tokens)

    def test_half_existing_website_pair_refused(self) -> None:
        self.seed("website/machine-tokens", "only-the-list")
        result = self.pre_apply()
        self.assertEqual(result.returncode, 1)
        self.assertIn("rotate-website-secrets.md", result.stderr)
        self.assertEqual(self.writes(), [])

    def test_integrations_key_is_a_fernet_key(self) -> None:
        self.assert_ok(self.pre_apply())
        key = self.value("integrations/encryption-keys")
        self.assertEqual(len(base64.urlsafe_b64decode(key)), 32)

    def test_deleted_secret_refused(self) -> None:
        self.seed("db/app-password", "x", deleted=True)
        result = self.pre_apply()
        self.assertEqual(result.returncode, 1)
        self.assertIn("restore-secret", result.stderr)
        self.assertEqual(self.writes(), [])

    def test_url_without_its_password_refused(self) -> None:
        self.seed("db/migrator-url", None)
        result = self.pre_apply()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.writes(), [])

    def test_pre_apply_prints_only_tfvars_lines(self) -> None:
        result = self.pre_apply()
        self.assert_ok(result)
        for line in result.stdout.splitlines():
            self.assertRegex(line, r'^(\w+ = "arn:[^"]+"|db_role_password_arns = \{|  \w+ += "arn:[^"]+"|\})$')

    # -- post-apply ------------------------------------------------------------

    def test_post_apply_fills_only_empty_urls(self) -> None:
        self.assert_ok(self.pre_apply())
        db = self.secrets()
        db[f"{PREFIX}/db/app-url"]["value"] = "postgres://prefilled"
        (self.dir / "secrets.json").write_text(json.dumps(db))

        self.assert_ok(self.post_apply())
        self.assertEqual(self.value("db/app-url"), "postgres://prefilled")
        url = urlsplit(self.value("db/migrator-url"))
        self.assertEqual(url.hostname, "db.internal")
        self.assertEqual(url.port, 5432)
        self.assertEqual(url.username, "schoolhub_migrator")
        self.assertEqual(url.password, self.value("db/migrator-password"))
        self.assertEqual(url.path, "/schoolhub")
        self.assertEqual(url.query, "sslmode=require")

    def test_post_apply_requires_db_host(self) -> None:
        self.assert_ok(self.pre_apply())
        self.reset_calls()
        result = self.run_script("--phase", "post-apply")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.writes(), [])

    def test_app_url_defaults_to_direct_rds(self) -> None:
        self.assert_ok(self.pre_apply())
        self.assert_ok(self.post_apply())
        url = urlsplit(self.value("db/app-url"))
        self.assertEqual(url.hostname, "db.internal")
        self.assertEqual(url.port, 5432)
        self.assertEqual(url.username, "schoolhub_app")
        self.assertEqual(url.password, self.value("db/app-password"))

    def test_app_url_takes_pooler_arguments(self) -> None:
        self.assert_ok(self.pre_apply())
        self.assert_ok(self.post_apply("--app-db-host", "pooler.internal", "--app-db-port", "6432"))
        url = urlsplit(self.value("db/app-url"))
        self.assertEqual((url.hostname, url.port), ("pooler.internal", 6432))
        migrator = urlsplit(self.value("db/migrator-url"))
        self.assertEqual((migrator.hostname, migrator.port), ("db.internal", 5432))

    # -- values never leak -----------------------------------------------------

    def test_values_never_in_argv_or_stdout(self) -> None:
        pre = self.pre_apply()
        post = self.post_apply()
        self.assert_ok(pre)
        self.assert_ok(post)
        values = [v for s in self.secrets().values() if (v := s["value"])]
        self.assertTrue(values)
        argv = "\n".join(" ".join(c) for c in self.calls())
        for value in values:
            self.assertNotIn(value, argv)
            self.assertNotIn(value, pre.stdout + post.stdout)
            self.assertNotIn(value, pre.stderr + post.stderr)

    # -- drift guard -----------------------------------------------------------

    def test_every_env_arn_variable_is_covered(self) -> None:
        result = self.pre_apply()
        self.assert_ok(result)
        printed = set(re.findall(r"^(\w+_arns?) = ", result.stdout, re.M))
        for env in ("staging", "production"):
            variables = (REPO / "infra" / "terraform" / "envs" / env / "variables.tf").read_text()
            for name in re.findall(r'variable "(\w+_arns?)"', variables):
                if name == "alarm_sns_topic_arns":
                    continue  # SNS topics, not secrets
                with self.subTest(env=env, variable=name):
                    self.assertTrue(
                        name in printed or name in EXTERNAL,
                        f"{name} is neither printed by bootstrap-secrets.sh nor listed as external",
                    )


if __name__ == "__main__":
    unittest.main()
