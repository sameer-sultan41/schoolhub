import { createPeriod, deletePeriod, fetchPeriodPage, updatePeriod } from "./periods-service";

export const PeriodsService = {
  fetchPeriodPage,
  createPeriod,
  updatePeriod,
  deletePeriod,
};
export type { PeriodInput, PeriodPageQuery, PeriodRecord } from "./periods-type";
