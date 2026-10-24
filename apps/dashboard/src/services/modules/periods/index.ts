import {
  createPeriod,
  deletePeriod,
  fetchCampusPeriods,
  fetchPeriodPage,
  updatePeriod,
} from "./periods-service";

export const PeriodsService = {
  fetchPeriodPage,
  fetchCampusPeriods,
  createPeriod,
  updatePeriod,
  deletePeriod,
};
export type { PeriodInput, PeriodPageQuery, PeriodRecord } from "./periods-type";
