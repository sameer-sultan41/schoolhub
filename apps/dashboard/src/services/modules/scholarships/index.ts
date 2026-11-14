import { createScholarship, listScholarships, updateScholarship } from "./scholarships-service";

export const ScholarshipsService = { listScholarships, createScholarship, updateScholarship };
export type {
  ScholarshipCoverage,
  ScholarshipInput,
  ScholarshipRecord,
  ScholarshipsQuery,
  ScholarshipStatus,
  ScholarshipType,
} from "./scholarships-type";
