"""Every task lands on a queue a worker consumes.

A task routed nowhere goes to the default queue, and a queue no worker reads is a job that
stays `queued` forever: a 202 is returned and nothing ever runs. The attendance export and
import did exactly that. The consumed queues are read from the worker definitions themselves
(compose and both Terraform environments), so the test follows them.
"""

from __future__ import annotations

import re
from pathlib import Path

from django.test import SimpleTestCase

from config.celery import app

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_DEFINITIONS = (
    REPO_ROOT / "infra/compose/docker-compose.yml",
    REPO_ROOT / "infra/terraform/envs/staging/main.tf",
    REPO_ROOT / "infra/terraform/envs/production/main.tf",
)
WORKER_QUEUES = re.compile(r'"worker".*?"-Q",\s*"([^"]+)"')


def consumed_queues(definition: Path) -> set[str]:
    found = WORKER_QUEUES.findall(definition.read_text())
    if not found:
        raise AssertionError(f"no celery worker -Q list in {definition}")
    return {queue for match in found for queue in match.split(",")}


def routed_queue(task_name: str) -> str:
    route = app.amqp.router.route({}, task_name, args=(), kwargs={})
    queue = route["queue"]
    return getattr(queue, "name", queue)


class CeleryRoutingTests(SimpleTestCase):
    def test_every_task_routes_to_a_queue_every_worker_consumes(self) -> None:
        app.loader.import_default_modules()
        tasks = sorted(name for name in app.tasks if not name.startswith("celery."))
        self.assertTrue(tasks, "no tasks were discovered")

        for definition in WORKER_DEFINITIONS:
            queues = consumed_queues(definition)
            for task in tasks:
                with self.subTest(task=task, worker=definition.relative_to(REPO_ROOT)):
                    self.assertIn(routed_queue(task), queues)

    def test_the_attendance_export_and_import_run_on_the_bulk_lane(self) -> None:
        for task in (
            "apps.attendance.tasks.export_attendance_report_task",
            "apps.attendance.tasks.import_attendance_task",
        ):
            with self.subTest(task=task):
                self.assertEqual(routed_queue(task), "bulk")
