# Entities: Certificates & Documents

> **Agent Context** — Load this block first.
> **Summary:** Column-level specs for the document engine: versioned merge-field templates, every rendered document (with workflow status and merge-data snapshot), and the immutable certificate issuance registry (serial numbers, public verification codes, revocation). Owned by [`certificates-documents.md`](../../03-modules/certificates-documents.md).
> **Co-load with:** `../../03-modules/certificates-documents.md` · `tenancy.md` (for `files`) · `people.md` (for `students`, `staff`)

**Conventions:** every table here is tenant-owned and implicitly has `id UUID PK`, `tenant_id FK`, `created_at`/`updated_at`, `created_by`/`updated_by`, `deleted_at` (soft delete) — exceptions only are stated. Rendered PDFs live in object storage via `files` ([`tenancy.md`](tenancy.md)); report cards, admit cards, and fee receipts are owned by their own modules, not here.

---

### document_templates
Versioned, tenant-scoped merge-field template for a certificate or letter category.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(150) | no | — | Display name |
| code | varchar(60) | no | — | Stable key, unique per tenant per version (e.g. `bonafide`) |
| category | varchar(40) | no | — | Enum: `bonafide` `transfer_certificate` `character_certificate` `staff_experience_letter` `staff_appointment_letter` `staff_noc` `custom` |
| subject_type | varchar(20) | no | — | Enum: `student` `staff` `other` — drives the merge-field catalog |
| body_html | text | no | — | HTML with `{{merge.field}}` placeholders; rendered by WeasyPrint |
| merge_fields | jsonb | no | `'[]'` | Declared placeholders: `{key, label, source(record|manual), required}` |
| paper_size | varchar(10) | no | `'A4'` | Enum: `A4` `Letter` |
| orientation | varchar(10) | no | `'portrait'` | Enum: `portrait` `landscape` |
| header_config | jsonb | no | `'{}'` | Logo/letterhead options from tenant branding |
| signatory_config | jsonb | no | `'[]'` | Signature blocks: `{title, name_source, signature_file_id}` |
| locale | varchar(10) | yes | — | Per-locale template variants; null = tenant default |
| version | integer | no | `1` | New version on every content edit; issued docs pin their version |
| status | varchar(20) | no | `'draft'` | Enum: `draft` `active` `superseded` `deactivated`; only `active` can generate |
| requires_approval | boolean | no | `true` | False enables auto-approve categories *(recommendation)* |
| serial_format | varchar(60) | yes | — | e.g. `{prefix}/{session}/{seq}`; null = tenant default |

Indexes: unique(tenant_id, code, version); (tenant_id, category, status).
Relationships: 1:N `generated_documents`. Superseding creates a new row (same `code`, incremented `version`) and flips the old row to `superseded`.

### generated_documents
Every rendered document instance with its workflow status and reproducibility snapshot.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| document_template_id | uuid | no | — | FK → document_templates (specific version row) |
| subject_type | varchar(20) | no | — | Enum: `student` `staff` `other` (mirrors template) |
| student_id | uuid | yes | — | FK → students ([`people.md`](people.md)); required when subject_type = `student` |
| staff_id | uuid | yes | — | FK → staff; required when subject_type = `staff` |
| merge_data | jsonb | no | `'{}'` | Resolved merge values snapshot — re-render reproducible even after source records change |
| purpose | varchar(300) | yes | — | Free-text purpose (e.g. "visa application"), printed if the template uses it |
| status | varchar(30) | no | `'draft'` | Enum: `draft` `pending_approval` `approved` `rejected` `issued` |
| requested_by_role | varchar(20) | yes | — | Enum: `staff` `student` `guardian` — self-service request origin *(recommendation)* |
| approved_by | uuid | yes | — | FK → users; must differ from `created_by` (segregation of duties) |
| approved_at | timestamptz | yes | — | |
| rejection_reason | text | yes | — | Required when status = `rejected` |
| file_id | uuid | yes | — | FK → files; frozen PDF (immutable once status = `issued`) |
| batch_job_id | uuid | yes | — | FK → background_jobs for bulk generation |

Indexes: (tenant_id, status); (tenant_id, student_id); (tenant_id, staff_id); (document_template_id).
Relationships: N:1 `document_templates`, `students`, `staff`, `files`, `background_jobs`; 1:1 optional `issued_certificates`.

### issued_certificates
The immutable issuance registry: serial number, public verification code, revocation state. **Exceptions:** rows are never soft-deleted (`deleted_at` unused — registry is permanent); post-issuance updates limited to revocation fields, enforced in the service layer and audited.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| generated_document_id | uuid | no | — | FK → generated_documents, unique (1:1) |
| certificate_type | varchar(40) | no | — | Copied from template category at issuance (survives template changes) |
| student_id | uuid | yes | — | FK → students; denormalized for registry queries |
| staff_id | uuid | yes | — | FK → staff |
| serial_number | varchar(60) | no | — | Unique per tenant; gapless per sequence, formatted per `serial_format` |
| verification_code | varchar(43) | no | — | Globally unique, ≥128-bit random, base64url; drives the public verify page *(recommendation)* |
| holder_name | varchar(200) | no | — | Name as printed — snapshot for verification display (minimal PII) |
| issued_at | timestamptz | no | — | `created_by` = issuing user |
| approved_by | uuid | no | — | FK → users; copied from the generated document at issuance |
| expires_at | timestamptz | yes | — | For time-limited certificates (e.g. bonafide validity) *(recommendation)* |
| is_duplicate | boolean | no | `false` | Marked duplicate copy; `original_certificate_id` set |
| original_certificate_id | uuid | yes | — | FK → issued_certificates (self) for duplicates |
| status | varchar(20) | no | `'issued'` | Enum: `issued` `revoked` |
| revoked_at | timestamptz | yes | — | |
| revoked_by | uuid | yes | — | FK → users |
| revoke_reason | text | yes | — | Required when status = `revoked` |

Indexes: unique(tenant_id, serial_number); unique(verification_code) [global — public lookup crosses tenants by design, rate-limited]; unique(generated_document_id); (tenant_id, certificate_type, issued_at); (tenant_id, student_id).
Relationships: 1:1 `generated_documents`; N:1 `students`, `staff`, `users` (approver, revoker); self-FK for duplicate copies.

---

## Relationship overview

- `document_templates` 1:N `generated_documents` 1:1 `issued_certificates` — draft → approval → registry.
- Subjects resolve to `students` / `staff` ([`people.md`](people.md)); rendered PDFs to `files` ([`tenancy.md`](tenancy.md)).
- The public verification endpoint reads only `issued_certificates` (`verification_code` → type, holder name, issue date, status) — never the underlying PDF or full profile.
- One active (non-revoked) certificate per (tenant, student, certificate_type, session) for uniqueness-sensitive types is an application-level rule (module doc §11), not a DB constraint, because duplicates are legitimate when flagged.
