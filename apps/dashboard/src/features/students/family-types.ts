/**
 * Hand-declared wire types for guardians, emergency contacts, student documents
 * and the two-step file upload — same convention as student-types.ts.
 */

import type { GUARDIAN_RELATIONSHIPS } from "@/features/students/student-constants";
import type { StudentAddress } from "@/features/students/student-types";

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export type DocumentVerificationStatus = "pending" | "verified" | "rejected";

export type UploadedFileStatus = "pending" | "ready" | "quarantined";

export interface GuardianRecord {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  occupation: string | null;
  employer: string | null;
  national_id: string | null;
  photo_file_id: string | null;
  address: StudentAddress | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** The student<->guardian link — `PATCH /student-guardians/{id}` updates the
 * flags below, `POST /students/{id}/guardians` creates one against an
 * existing guardian_id (see guardians-panel.tsx). */
export interface StudentGuardianLink {
  id: string;
  student_id: string;
  guardian_id: string;
  relationship: GuardianRelationship;
  is_primary: boolean;
  is_fee_responsible: boolean;
  can_pick_up: boolean;
  receives_communications: boolean;
  has_portal_access: boolean;
  access_revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmergencyContactRecord {
  id: string;
  student_id: string;
  name: string;
  /** Free text, not an enum — see apps.student_management.models.EmergencyContact. */
  relationship: string;
  phone: string;
  alt_phone: string | null;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentDocumentRecord {
  id: string;
  student_id: string;
  file_id: string;
  document_type: string;
  title: string;
  notes: string | null;
  verification_status: DocumentVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `POST /files` response — the created (pending) file row plus presigned-upload
 * details, per api-architecture.md §2.8. */
export interface CreatedUpload {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  purpose: string;
  status: UploadedFileStatus;
  visibility: string;
  created_at: string;
  updated_at: string;
  upload_url: string;
  upload_method: string;
  headers: Record<string, string>;
  expires_at: string;
}

/** `POST /files/{id}:confirm` response — the file row alone, no presigned fields. */
export interface UploadedFile {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  purpose: string;
  status: UploadedFileStatus;
  visibility: string;
  created_at: string;
  updated_at: string;
}
