"""Tests for .github/scripts/check_task_definition.py, run by repo-hygiene.yml (deploy-scripts)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".github" / "scripts"))
import check_task_definition as ctd  # its directory is put on sys.path just above

ACCOUNT = "111111111111"
REGISTRY = f"{ACCOUNT}.dkr.ecr.me-central-1.amazonaws.com"


def task_definition(env: str = "production", role_env: str | None = None, family: str | None = None,
            images: tuple[str, ...] = (f"{REGISTRY}/schoolhub/api:{'a' * 40}",)) -> dict:
    role_env = role_env or env
    return {
        "family": family or f"schoolhub-{env}-api",
        "taskRoleArn": f"arn:aws:iam::{ACCOUNT}:role/schoolhub-{role_env}-api-task",
        "executionRoleArn": f"arn:aws:iam::{ACCOUNT}:role/schoolhub-{role_env}-api-execution",
        "containerDefinitions": [{"name": f"c{i}", "image": image} for i, image in enumerate(images)],
    }


def check(td: dict, env: str = "production") -> list[str]:
    return ctd.problems(td, f"schoolhub-{env}", "api", env, ACCOUNT, REGISTRY)


class TaskDefinitionTests(unittest.TestCase):
    def test_valid_render_passes(self) -> None:
        self.assertEqual(check(task_definition()), [])

    def test_production_family_with_staging_role_fails(self) -> None:
        self.assertTrue(check(task_definition(role_env="staging")))

    def test_family_from_another_cluster_fails(self) -> None:
        self.assertTrue(check(task_definition(family="schoolhub-staging-api")))

    def test_sidecar_image_from_docker_hub_fails(self) -> None:
        images = (f"{REGISTRY}/schoolhub/api:{'a' * 40}", "docker.io/library/busybox:latest")
        self.assertTrue(check(task_definition(images=images)))

    def test_missing_task_role_fails(self) -> None:
        td = task_definition()
        del td["taskRoleArn"]
        self.assertTrue(check(td))

    def test_cluster_of_the_other_environment_fails(self) -> None:
        td = task_definition(env="staging")
        self.assertTrue(ctd.problems(td, "schoolhub-staging", "api", "production", ACCOUNT, REGISTRY))


if __name__ == "__main__":
    unittest.main()
