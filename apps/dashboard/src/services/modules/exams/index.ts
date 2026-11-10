import { createExam, deleteExam, fetchExam, fetchExamsPage, updateExam } from "./exams-service";

export const ExamsService = {
  fetchExamsPage,
  fetchExam,
  createExam,
  updateExam,
  deleteExam,
};
export type { ExamInput, ExamPageQuery, ExamRecord, ExamStatus, ExamType } from "./exams-type";
