import {
  createBand,
  createScale,
  deleteBand,
  deleteScale,
  fetchBands,
  fetchScale,
  fetchScalesPage,
  setDefault,
  updateBand,
  updateScale,
} from "./grading-scales-service";

export const GradingScalesService = {
  fetchScalesPage,
  fetchScale,
  createScale,
  updateScale,
  deleteScale,
  setDefault,
  fetchBands,
  createBand,
  updateBand,
  deleteBand,
};
export type {
  CoverageIssue,
  GradeBandInput,
  GradeBandRecord,
  GradingScaleInput,
  GradingScalePageQuery,
  GradingScaleRecord,
  GradingScaleType,
} from "./grading-scales-type";
