# Entities: Communication

> **Agent Context** — Load this block first.
> **Summary:** Column-level specs for the communication module's tables: announcements, notices, message threads/messages, notification templates, notifications, notification preferences, and delivery logs. All tables are tenant-owned and carry the implicit standard columns (id UUID PK, tenant_id FK, created_at/updated_at, created_by/updated_by, deleted_at) per [`../database-architecture.md`](../../02-architecture/database-architecture.md); only exceptions are stated. Timestamps are `timestamptz`; display timezone is tenant-configured.
> **Co-load with:** `../../03-modules/communication.md` · `tenancy.md` (users, files) · `people.md` (students) · `academics.md` (campuses)

### announcements

Feed-style posts targeted at a school audience, with draft/schedule/publish lifecycle.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| title | varchar(200) | NO | — | |
| body | text | NO | — | Rich text (sanitized HTML/Markdown) |
| audience_type | varchar(20) | NO | `'all'` | Enum: `all`, `staff`, `students`, `guardians`, `class`, `section`, `custom` |
| audience_filter | jsonb | YES | — | Role slugs / class, section, house, campus ids / user ids for `custom` |
| campus_id | uuid | YES | — | FK → `campuses.id`; NULL = all campuses |
| status | varchar(20) | NO | `'draft'` | Enum: `draft`, `scheduled`, `published`, `archived` |
| is_emergency | boolean | NO | `false` | Emergency posts bypass preferences on fan-out |
| publish_at | timestamptz | YES | — | Set when scheduled |
| expires_at | timestamptz | YES | — | Hidden from feeds after expiry |
| show_on_website | boolean | NO | `false` | Exposed read-only to the website renderer |
| attachments | jsonb | YES | — | Array of `files.id` references |
| published_by | uuid | YES | — | FK → `users.id` |
| published_at | timestamptz | YES | — | |

Indexes: `(tenant_id, status, publish_at)`; `(tenant_id, campus_id)`; partial `(tenant_id, show_on_website) WHERE show_on_website`.
Relationships: N:1 `campuses`, N:1 `users` (published_by); fan-out 1:N `notifications` (via `source_type/source_id`).

### notices

Formal, per-tenant-numbered notices with publish approval, validity window, and optional acknowledgment tracking.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| notice_no | varchar(50) | YES | — | Assigned at publish from tenant sequence; UNIQUE `(tenant_id, notice_no)` |
| title | varchar(200) | NO | — | |
| body | text | NO | — | |
| notice_type | varchar(20) | NO | `'general'` | Enum: `general`, `circular`, `event`, `urgent` |
| audience_type | varchar(20) | NO | `'all'` | Same enum as `announcements.audience_type` |
| audience_filter | jsonb | YES | — | Same shape as announcements |
| status | varchar(20) | NO | `'draft'` | Enum: `draft`, `pending_approval`, `published`, `archived` |
| requires_acknowledgment | boolean | NO | `false` | Acknowledgments tracked per recipient on `notifications.acknowledged_at` |
| publish_at | timestamptz | YES | — | |
| valid_until | date | YES | — | |
| show_on_website | boolean | NO | `false` | |
| attachments | jsonb | YES | — | Array of `files.id` |
| approved_by | uuid | YES | — | FK → `users.id`; must differ from `created_by` |
| published_at | timestamptz | YES | — | |

Indexes: UNIQUE `(tenant_id, notice_no)`; `(tenant_id, status, publish_at)`.
Relationships: N:1 `users` (approved_by); fan-out 1:N `notifications`.

### message_threads

Conversation containers: guardian ↔ school (child-contextual), internal staff, or group threads.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| subject | varchar(200) | NO | — | |
| thread_type | varchar(20) | NO | `'guardian_school'` | Enum: `guardian_school`, `internal`, `group` |
| student_id | uuid | YES | — | FK → `students.id`; child context for guardian threads |
| participant_user_ids | jsonb | NO | — | Array of `users.id`; see module doc §19 (join-table promotion is a flagged recommendation) |
| assigned_to | uuid | YES | — | FK → `users.id`; staff member currently responsible |
| status | varchar(10) | NO | `'open'` | Enum: `open`, `closed` |
| last_message_at | timestamptz | YES | — | Denormalized for inbox sorting |
| closed_at | timestamptz | YES | — | |

Indexes: `(tenant_id, status, last_message_at DESC)`; `(tenant_id, student_id)`; GIN `(participant_user_ids)`.
Relationships: N:1 `students`; N:1 `users` (assigned_to); 1:N `messages`.

### messages

Individual posts within a thread.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| thread_id | uuid | NO | — | FK → `message_threads.id` |
| sender_id | uuid | NO | — | FK → `users.id`; must be a thread participant |
| body | text | NO | — | |
| attachments | jsonb | YES | — | Array of `files.id` |
| is_internal_note | boolean | NO | `false` | Staff-only visibility (recommendation) |
| read_by | jsonb | YES | — | Map `user_id → read timestamp` |
| sent_at | timestamptz | NO | `now()` | |

Exceptions to standard columns: rows are immutable after send — `updated_at/updated_by` unused (edits disallowed; deletes are soft).
Indexes: `(tenant_id, thread_id, sent_at)`.
Relationships: N:1 `message_threads`; N:1 `users` (sender).

### notification_templates

Per event/channel/locale render templates with typed placeholders; system rows seeded at tenant provisioning.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| code | varchar(100) | NO | — | Event template key, e.g. `fees.due-reminder`; UNIQUE `(tenant_id, code, channel, locale)` |
| name | varchar(150) | NO | — | Human label |
| channel | varchar(10) | NO | — | Enum: `email`, `sms`, `push`, `in_app`, `whatsapp` |
| locale | varchar(10) | NO | `'en'` | BCP-47 tag |
| subject | varchar(200) | YES | — | Email/push title; NULL for SMS |
| body | text | NO | — | Placeholder syntax `{{variable}}` |
| variables | jsonb | NO | — | Declared placeholder set; validated against event schema |
| is_system | boolean | NO | `false` | Seeded rows; body editable, code/channel locked |
| is_active | boolean | NO | `true` | Inactive → channel falls back to platform default template |

Indexes: UNIQUE `(tenant_id, code, channel, locale)`.
Relationships: referenced by `delivery_logs.template_code` (soft reference by code, survives template edits).

### notifications

Per-recipient notification records — the in-app source of truth and the fan-out parent for channel deliveries.

> **Owned by `core/notifications/`, not this module.** `notifications` and `delivery_logs` are the delivery *machinery*, and [`../../02-architecture/notifications.md`](../../02-architecture/notifications.md) §1 places the adapter interface in `core/notifications/` while §10 draws the line: module docs supply the trigger-catalog *content*, the architecture doc defines the machinery. Attendance (Tier 2) needs it long before communication (Tier 4) ships, so core owns these two tables plus the adapters, the platform default templates and `notify()`. This module still owns everything tenant-facing: `notification_templates` (tenant overrides), `notification_preferences`, announcements/notices/threads, the delivery dashboard, and the SMS/push/WhatsApp adapters.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| user_id | uuid | NO | — | FK → `users.id` (recipient) |
| event_key | varchar(100) | NO | — | Producing event, e.g. `attendance.absent`, `notice.published` |
| category | varchar(30) | NO | `'general'` | Enum: `attendance`, `fees`, `exams`, `library`, `transport`, `academic`, `general`, `emergency`; matches `notification_preferences.event_category` |
| title | varchar(200) | NO | — | Rendered |
| body | text | NO | — | Rendered |
| data | jsonb | YES | — | Deep-link payload (resource type/id, route) |
| source_type | varchar(50) | YES | — | Polymorphic origin, e.g. `announcement`, `notice`, `fee_invoice` |
| source_id | uuid | YES | — | Origin row id (validated in service layer) |
| priority | varchar(10) | NO | `'normal'` | Enum: `normal`, `high`, `emergency` |
| read_at | timestamptz | YES | — | In-app read marker |
| acknowledged_at | timestamptz | YES | — | Set when the user acknowledges an ack-required notice |

Indexes: `(tenant_id, user_id, read_at, created_at DESC)`; `(tenant_id, source_type, source_id)`.
Relationships: N:1 `users`; 1:N `delivery_logs`; polymorphic N:1 to source rows.

### notification_preferences

User × event-category × channel opt-in matrix.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| user_id | uuid | NO | — | FK → `users.id` |
| event_category | varchar(30) | NO | — | Same enum as `notifications.category`; `emergency` rows cannot be disabled (service-enforced) |
| channel | varchar(10) | NO | — | Enum: `email`, `sms`, `push`, `in_app`, `whatsapp` |
| is_enabled | boolean | NO | `true` | |

Indexes: UNIQUE `(tenant_id, user_id, event_category, channel)`.
Relationships: N:1 `users`.

### delivery_logs

Per-channel, per-attempt delivery records for every outbound send; updated by provider webhooks.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| notification_id | uuid | NO | — | FK → `notifications.id` |
| channel | varchar(10) | NO | — | Enum: `email`, `sms`, `push`, `in_app`, `whatsapp` |
| template_code | varchar(100) | YES | — | Template used at render time (soft reference) |
| provider | varchar(50) | YES | — | Adapter name, e.g. `ses`, `twilio`, `fcm` |
| provider_message_id | varchar(150) | YES | — | Provider correlation key |
| recipient_address | varchar(255) | NO | — | Email/phone/device token — stored masked per PII policy |
| status | varchar(15) | NO | `'queued'` | Enum: `queued`, `sent`, `delivered`, `failed`, `bounced`, `skipped` (`skipped` = disabled by preference/quota) |
| attempts | smallint | NO | `0` | Retry policy per [`../../02-architecture/notifications.md`](../../02-architecture/notifications.md) |
| error_message | text | YES | — | Last provider error |
| last_attempt_at | timestamptz | YES | — | |
| delivered_at | timestamptz | YES | — | |

Exceptions to standard columns: high-volume operational table — no soft delete (`deleted_at` unused); purged by retention job instead.
Indexes: `(tenant_id, status, last_attempt_at)`; `(tenant_id, notification_id)`; `(provider_message_id)`.
Relationships: N:1 `notifications`; soft reference to `notification_templates` by code.
