# Entities: Website & CMS

> **Agent Context** — Load this block first.
> **Summary:** Column-level specs for the tenant public-website CMS: site settings, the platform theme catalog, pages with typed dynamic sections, navigation menus, news, events, galleries, contact submissions, and SEO settings. Owned by the [`website-cms.md`](../../03-modules/website-cms.md) module; consumed read-only by the public renderer ([`website-builder.md`](../../02-architecture/website-builder.md)).
> **Co-load with:** `../../03-modules/website-cms.md` · `tenancy.md` (for `custom_domains`, `tenant_settings`, `files`)

**Conventions:** every tenant-owned table implicitly has `id UUID PK`, `tenant_id FK`, `created_at`/`updated_at`, `created_by`/`updated_by`, `deleted_at` (soft delete) — exceptions only are stated. `themes` is the single **platform-scope** table here (no `tenant_id`). Branding (logo, colors, fonts) is **not** duplicated here — it lives in `tenant_settings` ([`tenancy.md`](tenancy.md)); custom domains live in `custom_domains` (same file).

---

### website_settings
One row per tenant: the website's global state and theme binding.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| theme_id | uuid | no | — | FK → themes (active theme) |
| theme_config | jsonb | no | `'{}'` | Values validated against `themes.config_schema` |
| homepage_page_id | uuid | yes | — | FK → website_pages; exactly one homepage |
| is_published | boolean | no | `false` | Master on/off for the public site |
| maintenance_mode | boolean | no | `false` | Neutral notice page; forced during tenant suspension |
| header_config | jsonb | no | `'{}'` | Announcement bar, contact strip, CTA button |
| footer_config | jsonb | no | `'{}'` | Footer columns, contact block, copyright line |
| social_links | jsonb | no | `'[]'` | Ordered `{platform, url}` list |
| analytics_id | varchar(60) | yes | — | Tenant-supplied analytics property id *(recommendation)* |
| default_locale | varchar(10) | yes | — | Falls back to `tenant_settings.locale` |

Indexes: unique(tenant_id).
Relationships: N:1 `themes`; 1:1 `tenants`; optional 1:1 `website_pages` (homepage).

### themes
**Platform scope — no `tenant_id`.** Catalog of website themes; one ships at launch, more later (scope §11). Tenants reference, never edit.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(100) | no | — | Display name |
| code | varchar(50) | no | — | Unique, stable key used by the renderer |
| version | varchar(20) | no | — | Semver; renderer pins per-version templates |
| description | text | yes | — | |
| preview_file_id | uuid | yes | — | FK → files (platform asset) |
| section_types | jsonb | no | `'[]'` | Declared section catalog: type key + JSON schema per type |
| config_schema | jsonb | no | `'{}'` | JSON schema for `website_settings.theme_config` |
| is_active | boolean | no | `true` | Inactive themes hidden from selection |

Indexes: unique(code); (is_active).
Relationships: 1:N `website_settings`.

### website_pages
A page on the public site — standard (homepage, about, principal message, departments, teachers, classes, admissions, contact) or custom.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| title | varchar(200) | no | — | |
| slug | varchar(120) | no | — | Unique per tenant; reserved slugs blocked |
| page_type | varchar(30) | no | `'standard'` | Enum: `home` `about` `principal_message` `departments` `teachers` `classes` `admissions` `contact` `standard` |
| status | varchar(20) | no | `'draft'` | Enum: `draft` `published` `archived` |
| published_at | timestamptz | yes | — | |
| locale | varchar(10) | yes | — | Per-locale page variants; null = default locale |
| show_in_search | boolean | no | `true` | Renderer no-indexes when false |

Indexes: unique(tenant_id, slug, locale); (tenant_id, status, page_type).
Relationships: 1:N `page_sections`; targeted by `navigation_menus` items and `seo_settings`.

### page_sections
Ordered typed content blocks composing a page; types come from the active theme's `section_types`.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| website_page_id | uuid | no | — | FK → website_pages |
| section_type | varchar(50) | no | — | Must exist in the active theme's catalog (e.g. `hero`, `rich_text`, `stats`, `staff_grid`, `cta`, `faq`, `form_embed`) |
| position | integer | no | — | Order within the page |
| content | jsonb | no | `'{}'` | Validated against the section type's JSON schema |
| is_visible | boolean | no | `true` | Hide without deleting |

Indexes: unique(website_page_id, position); (website_page_id).
Relationships: N:1 `website_pages`; media references inside `content` are `files` ids.

### navigation_menus
Editable menu trees per site location.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| location | varchar(30) | no | — | Enum: `header` `footer_primary` `footer_secondary` |
| items | jsonb | no | `'[]'` | Nested tree: `{label, target_type(page|url|news_index|events_index|gallery_index), target, children[]}` |

Indexes: unique(tenant_id, location).
Relationships: item targets reference `website_pages` by id (validated on save).

### news_posts
School news articles with listing + detail pages.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| title | varchar(200) | no | — | |
| slug | varchar(120) | no | — | Unique per tenant |
| excerpt | varchar(500) | yes | — | Listing/OG fallback text |
| body | jsonb | no | `'{}'` | Structured rich text |
| cover_image_file_id | uuid | yes | — | FK → files |
| status | varchar(20) | no | `'draft'` | Enum: `draft` `published` `archived` |
| published_at | timestamptz | yes | — | Display date; scheduling *(recommendation)* |
| locale | varchar(10) | yes | — | Null = default locale |

Indexes: unique(tenant_id, slug); (tenant_id, status, published_at).
Relationships: author = `created_by`; `seo_settings` may target a post.

### school_events
Public website events (open day, annual function). Distinct from the academic calendar (academics module) and from communication-module notices.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| title | varchar(200) | no | — | |
| slug | varchar(120) | no | — | Unique per tenant |
| description | jsonb | no | `'{}'` | Structured rich text |
| starts_at | timestamptz | no | — | Tenant timezone applied at render |
| ends_at | timestamptz | yes | — | ≥ starts_at |
| is_all_day | boolean | no | `false` | |
| location | varchar(200) | yes | — | Free text / campus name |
| cover_image_file_id | uuid | yes | — | FK → files |
| status | varchar(20) | no | `'draft'` | Enum: `draft` `published` `archived` |

Indexes: unique(tenant_id, slug); (tenant_id, status, starts_at).
Relationships: optionally linked from `gallery_albums.school_event_id`.

### gallery_albums
Photo/video albums for the gallery section.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| title | varchar(200) | no | — | |
| slug | varchar(120) | no | — | Unique per tenant |
| description | text | yes | — | |
| cover_image_file_id | uuid | yes | — | FK → files; falls back to first item |
| school_event_id | uuid | yes | — | FK → school_events (album of an event) |
| status | varchar(20) | no | `'draft'` | Enum: `draft` `published` `archived` |
| published_at | timestamptz | yes | — | |

Indexes: unique(tenant_id, slug); (tenant_id, status).
Relationships: 1:N `gallery_items`; N:1 `school_events` (optional).

### gallery_items
Individual media entries inside an album.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| gallery_album_id | uuid | no | — | FK → gallery_albums |
| media_type | varchar(20) | no | `'image'` | Enum: `image` `video_embed` |
| file_id | uuid | yes | — | FK → files; required when media_type = `image` |
| embed_url | varchar(500) | yes | — | Required when media_type = `video_embed`; provider whitelist |
| caption | varchar(300) | yes | — | |
| alt_text | varchar(300) | yes | — | Accessibility; AI-suggested via `AI-WEB-03` |
| position | integer | no | — | Order within album |

Indexes: unique(gallery_album_id, position); (gallery_album_id).
Relationships: N:1 `gallery_albums`; N:1 `files`.

### contact_submissions
Public contact-form submissions. **Exceptions:** `created_by` is NULL (submitter is unauthenticated); no `updated_by` on public insert path.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(150) | no | — | |
| email | varchar(254) | yes | — | Email or phone required (application-level rule) |
| phone | varchar(30) | yes | — | |
| subject | varchar(200) | yes | — | |
| message | text | no | — | Length-capped |
| source_page_id | uuid | yes | — | FK → website_pages (where the form lived) |
| status | varchar(20) | no | `'new'` | Enum: `new` `read` `responded` `spam` |
| handled_by | uuid | yes | — | FK → users (triaging staff member) |
| ip | inet | yes | — | Rate limiting/spam; retention-limited per privacy policy |

Indexes: (tenant_id, status, created_at).
Relationships: N:1 `website_pages`, `users`. Admission-form submissions are **not** stored here — they create enquiry/application records in [`admissions.md`](admissions.md).

### seo_settings
Site-wide and per-content SEO metadata (scope §11 SEO; §22 SEO for public websites).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| target_type | varchar(30) | no | — | Enum: `site` `page` `news_post` `school_event` `gallery_album` |
| target_id | uuid | yes | — | FK to the target row; NULL when target_type = `site` |
| meta_title | varchar(70) | yes | — | |
| meta_description | varchar(170) | yes | — | |
| og_image_file_id | uuid | yes | — | FK → files |
| canonical_url | varchar(500) | yes | — | |
| robots | varchar(50) | yes | — | e.g. `noindex,nofollow` |
| structured_data | jsonb | yes | — | JSON-LD overrides; renderer emits sane defaults |

Indexes: unique(tenant_id, target_type, target_id).
Relationships: polymorphic target (validated in the service layer, per target_type). One `site` row per tenant.

---

## Relationship overview

- `website_settings` N:1 `themes` (platform catalog) and optionally 1:1 `website_pages` (homepage).
- `website_pages` 1:N `page_sections` (ordered, schema-validated by theme section type).
- `gallery_albums` 1:N `gallery_items`; optional N:1 `school_events`.
- `seo_settings` targets any publishable content row or the whole site.
- All tables except `themes` are tenant-owned and RLS-scoped; the public renderer reads them through a scoped machine token restricted to `published` content ([`api-architecture.md`](../../02-architecture/api-architecture.md) §2.2).
