import {
  cloneCurriculum,
  createCurriculum,
  deleteCurriculum,
  fetchCurriculumForClass,
  fetchCurriculumPage,
  updateCurriculum,
} from "./curriculum-service";

export const CurriculumService = {
  fetchCurriculumPage,
  fetchCurriculumForClass,
  createCurriculum,
  updateCurriculum,
  deleteCurriculum,
  cloneCurriculum,
};
export type {
  CloneCurriculumResult,
  CurriculumInput,
  CurriculumPageQuery,
  CurriculumRecord,
} from "./curriculum-type";
