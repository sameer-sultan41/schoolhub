import type { ResultRecord } from "@/services";

type ResultOutcome = ResultRecord["outcome"];

/** Every outcome to its message key under `portal.results` (L32: exhaustive). */
export const RESULT_OUTCOME_LABEL_KEY: Record<ResultOutcome, `outcome.${ResultOutcome}`> = {
  pass: "outcome.pass",
  fail: "outcome.fail",
  absent: "outcome.absent",
  withheld: "outcome.withheld",
};

export const RESULT_OUTCOME_BADGE: Record<ResultOutcome, "success" | "destructive" | "secondary"> =
  {
    pass: "success",
    fail: "destructive",
    absent: "secondary",
    withheld: "secondary",
  };
