import {
  createExamSubject,
  deleteExamSubject,
  fetchExamSubjects,
  updateExamSubject,
} from "./exam-subjects-service";

export const ExamSubjectsService = {
  fetchExamSubjects,
  createExamSubject,
  updateExamSubject,
  deleteExamSubject,
};
export type { ExamSubjectGroup, ExamSubjectInput, ExamSubjectRecord } from "./exam-subjects-type";
