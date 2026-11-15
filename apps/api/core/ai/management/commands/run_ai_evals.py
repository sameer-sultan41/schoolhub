"""Run one AI feature's golden set against the real provider and compare with its baseline.

    uv run manage.py run_ai_evals --feature fees.report-summary
    uv run manage.py run_ai_evals --feature fees.report-summary --write-baseline

Always the real provider, whatever ``AI_PROVIDER`` says: an eval against the fake
proves nothing. A missing API key, a missing baseline, a score below the baseline
(minus its tolerance) or any adversarial leak fails the command. The
``ai-evals`` workflow runs it (``.github/workflows/ai-evals.yml``); ADR-0035.

Current models take no sampling parameters (no ``temperature``), so a run is not
bit-for-bit repeatable; the baseline's tolerance absorbs that noise.
"""

from __future__ import annotations

import json
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser

from core.ai.evals import (
    DEFAULT_TOLERANCE,
    EvalReport,
    baseline_document,
    compare_with_baseline,
    eval_suites,
    read_baseline,
    run_suite,
)
from core.ai.providers.anthropic import AnthropicProvider
from core.ai.registry import registry
from core.ai.service import model_for_tier


class Command(BaseCommand):
    help = "Score an AI feature's golden set on the real provider against its committed baseline."
    # No database is touched: golden cases are JSON, and nothing is metered or audited.
    requires_system_checks: list[str] = []

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--feature", required=True, help="The AI feature key, e.g. fees.report-summary."
        )
        parser.add_argument(
            "--write-baseline",
            action="store_true",
            help="Write this run's scores as the baseline (commit the file it names).",
        )
        parser.add_argument(
            "--tolerance",
            type=float,
            default=None,
            help=f"Override the baseline's tolerance (default {DEFAULT_TOLERANCE}).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        feature_key: str = options["feature"]
        try:
            feature = registry.get(feature_key)
            suite = eval_suites.get(feature_key)
        except LookupError as exc:
            raise CommandError(str(exc)) from exc

        api_key: str = settings.ANTHROPIC_API_KEY
        provider = AnthropicProvider(api_key=api_key)
        if not provider.is_configured():
            raise CommandError(
                "ANTHROPIC_API_KEY is not set. The evals call the real provider; set a "
                "spend-capped key (the `ai-evals` environment's secret in CI)."
            )

        baseline = read_baseline(suite.baseline_path)
        if baseline is None and not options["write_baseline"]:
            raise CommandError(
                f"No baseline at {suite.baseline_path}. Run with --write-baseline once, "
                "review the scores, and commit the file before enabling the feature."
            )

        deadline: int = settings.AI_REQUEST_DEADLINE_SECONDS
        report = run_suite(
            suite,
            feature,
            provider=provider,
            model=model_for_tier(feature.tier),
            deadline_seconds=float(deadline),
        )
        self._print(report)

        if baseline is None or options["write_baseline"]:
            tolerance: float = options["tolerance"] or DEFAULT_TOLERANCE
            document = baseline_document(report, tolerance=tolerance)
            suite.baseline_path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
            self.stdout.write(f"Baseline written to {suite.baseline_path}.")
            failures = compare_with_baseline(report, {"scores": {}})
        else:
            failures = compare_with_baseline(report, baseline, tolerance=options["tolerance"])

        if failures:
            raise CommandError("AI evals failed:\n- " + "\n- ".join(failures))
        self.stdout.write(self.style.SUCCESS(f"AI evals passed for {feature_key}."))

    def _print(self, report: EvalReport) -> None:
        self.stdout.write(
            f"{report.feature_key} ({report.prompt_version}) on {report.model}: "
            f"{len(report.results)} cases"
        )
        for name, value in report.scores.items():
            self.stdout.write(f"  {name}: {value:.4f}")
        for result in report.results:
            if not result.passed_validator or result.forbidden_hits:
                self.stdout.write(
                    f"  - {result.id}: validator={'ok' if result.passed_validator else 'refused'}"
                    f" reason={result.reason} forbidden={result.forbidden_hits}"
                )
