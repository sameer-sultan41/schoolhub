import {
  createStudent,
  fetchStudentById,
  fetchStudentsPage,
  updateStudent,
  withdrawStudent,
} from "./students-service";

export const StudentsService = {
  fetchStudentsPage,
  fetchStudentById,
  createStudent,
  updateStudent,
  withdrawStudent,
};
export type {
  CreateStudentInput,
  StudentRecord,
  StudentsPageQuery,
  UpdateStudentInput,
  WithdrawStudentInput,
} from "./students-service";
