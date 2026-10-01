import { stableSignedUrl } from "@/lib/helpers";
import type { StudentRecord } from "@/services";

export interface StudentRow {
  id: string;
  admissionNumber: string;
  name: string;
  status: string;
  campus: string;
  house: string | null;
  admissionDate: string;
  updatedAt: string;
  /** Already resolved through `stableSignedUrl` and normalized to `undefined` (not
   * `null`) once here, so every consumer can pass it straight to `AvatarImage src`
   * without repeating the null-check. */
  signedPhotoUrl: string | undefined;
}

export function toStudentRow(record: StudentRecord): StudentRow {
  return {
    id: record.id,
    // The generated schema types this optional (admission_number can, in principle, be
    // unset between a PATCH request and the server allocating one) — the API never
    // actually returns a student without one, but `?? ""` keeps the row's own type honest.
    admissionNumber: record.admission_number ?? "",
    name: [record.first_name, record.last_name].join(" "),
    status: record.status,
    campus: record.campus_name,
    house: record.house_name,
    admissionDate: record.admission_date,
    updatedAt: record.updated_at,
    signedPhotoUrl: stableSignedUrl(record.photo_url) ?? undefined,
  };
}
