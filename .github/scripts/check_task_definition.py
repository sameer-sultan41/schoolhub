#!/usr/bin/env python3
"""Deploy gate: does a rendered task definition belong to this environment?

    check_task_definition.py --file <rendered.json> --cluster <cluster> --service <service>
                             --env <staging|production> --account <id> --registry <registry>

Runs after amazon-ecs-render-task-definition and before anything is registered. It fails
unless the family is `<cluster>-<service>` with `<cluster> == schoolhub-<env>`, both task
roles belong to `schoolhub-<env>-`, and every container image comes from
`<registry>/schoolhub/`. This stops a staging-registered revision landing in a production
family, or a task role from the other environment (Review Focus 1).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def problems(
    task_definition: dict, cluster: str, service: str, env: str, account: str, registry: str
) -> list[str]:
    found = []
    if cluster != f"schoolhub-{env}":
        found.append(f"cluster {cluster!r} is not schoolhub-{env}")
    family = task_definition.get("family")
    if family != f"{cluster}-{service}":
        found.append(f"family {family!r} is not {cluster}-{service}")
    role_prefix = f"arn:aws:iam::{account}:role/schoolhub-{env}-"
    for key in ("taskRoleArn", "executionRoleArn"):
        value = task_definition.get(key)
        if not isinstance(value, str) or not value.startswith(role_prefix):
            found.append(f"{key} {value!r} does not start with {role_prefix}")
    containers = task_definition.get("containerDefinitions") or []
    if not containers:
        found.append("no containerDefinitions")
    image_prefix = f"{registry}/schoolhub/"
    for container in containers:
        image = container.get("image")
        if not isinstance(image, str) or not image.startswith(image_prefix):
            found.append(f"container {container.get('name')!r} image {image!r} is not from {image_prefix}")
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for flag in ("--file", "--cluster", "--service", "--env", "--account", "--registry"):
        parser.add_argument(flag, required=True)
    args = parser.parse_args(argv[1:])
    task_definition = json.loads(Path(args.file).read_text())
    found = problems(task_definition, args.cluster, args.service, args.env, args.account, args.registry)
    for problem in found:
        print(f"::error::task definition for {args.service}: {problem}")
    if not found:
        print(f"task definition for {args.service} belongs to {args.env}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
