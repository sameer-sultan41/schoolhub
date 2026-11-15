# 0038. Public website content is block rich text and theme-schema-validated sections, with `safe-url` links

- **Status:** Accepted
- **Date:** 2026-11-15
- **Enforced by:** `apps/api/apps/website_cms/tests/test_registry.py` (theme schemas use only the allowed keywords, widgets and formats; the default theme syncs on `post_migrate` and re-syncs without a migration; the rich-text schema is valid; `SectionType` equals the theme's keys); `test_validation.py` (section content against its schema, `javascript:`, `data:`, `http:`, `//host` and `/\host` refused, image ids from another tenant or not `ready` refused, `sync_file_visibility` public only while a published row references the file); `pages/tests/test_endpoints.py` (invalid section content is a 422 keyed by path, replace and reorder with colliding positions, theme switch); `navigation/tests/test_endpoints.py` and `seo/tests/test_endpoints.py` (links and `canonical_url` through `safe-url`); `core/files/tests/test_visibility.py` (the provider registry); `website_cms/tests/test_cross_tenant.py`. A dashboard widget for a new schema keyword is review only

## Context

[website-cms.md](../03-modules/website-cms.md) §5.10 requires that a new theme ships without
per-tenant or per-type code paths, and the public renderer must be XSS-free whatever an editor
types. The entity doc already stores section content and rich text as `jsonb`, validated against
the active theme's JSON Schema, but did not say which schema dialect, how rich text is shaped,
how links are checked, or how a theme reaches the database. The plan is
[`docs/superpowers/plans/2026-11-15-website-cms.md`](../superpowers/plans/2026-11-15-website-cms.md).

## Decision

1. **Rich text is a block document, not HTML.** `{"blocks": [...]}`, where a block is a
   `paragraph`, a `heading` (levels 2 to 4), a `list` (ordered or unordered), a `quote` or an
   `image` (`file_id`, `alt`). The schema is `website_cms/schemas/rich_text.json`. News bodies,
   event descriptions and the `rich_text` section all use it. The renderer and the dashboard
   render blocks as elements and never use `dangerouslySetInnerHTML`, so there is no markup to
   sanitise.
2. **Section content is validated against a constrained JSON Schema subset** declared by the
   theme: `type`, `properties`, `required`, `items`, `enum`, `maxLength`, `minLength`,
   `minimum`, `maximum`, `format: safe-url` and a `$ref` to the rich-text schema, plus an
   `x-widget` hint (`text`, `textarea`, `image`, `rich-text`, `url`) that tells the dashboard
   which control to draw. `jsonschema.Draft202012Validator` does the validation, with the
   rich-text schema supplied through a `referencing.Registry`. The bounds keywords were added
   because the renderer's zod schemas reject an empty text or an out-of-range limit by
   rendering nothing. A test fails if a theme uses a keyword outside the subset, so the
   dashboard's schema-driven form (one component over this subset) stays complete.
3. **Themes are declared in code and synced on `post_migrate`.** `themes/default.json` (code
   `default`, version `1.0.0`) is loaded by `sync_themes_on_migrate`, the pattern
   `sync_feature_flags_on_migrate` already uses, which upserts the `themes` row, so editing a
   theme file needs no data migration. `themes.section_types` is a dict,
   `{type: {label, schema}}`, so a type is looked up by key.
4. **Every link is `safe-url`.** An `https:` URL with a host, or a `/`-relative path that does
   not start `//` or `/\`, with no whitespace or control characters. It is a custom JSON Schema
   format checked by a `FormatChecker` that the validator is **explicitly** given and that
   knows no other format. The same `is_safe_url` function backs every non-schema link: social
   links, header and footer links, `canonical_url` and navigation targets.

## Alternatives considered

| Decision | Rejected | Why |
| --- | --- | --- |
| Rich text | HTML stored and cleaned by a sanitiser (`nh3`) | Sanitiser bypasses are a recurring CVE class, while a block document cannot carry markup at all. A block tree also matches the `jsonb` column and lets the renderer choose its elements. |
| Section forms | RJSF or JSON Forms | Both bring their own widget and validation stack outside `packages/ui` and react-hook-form + zod, and support far more of JSON Schema than the subset allows. About 300 lines of `SchemaFields` over the subset stay on-system and testable. |
| Section forms | A hand-built form per section type | Contradicts §5.10: a new theme would need dashboard code. |
| Theme delivery | Seeding themes by data migration | Every theme edit would need a migration. The `post_migrate` sync reuses the feature-flag pattern. |
| Links | `format: uri` | jsonschema skips a format that has no checker, and RFC 3986 accepts `javascript:`, so the check would be absent or too weak. |
| Links | Letting the default format checker in | It would silently enable formats such as `uri-reference` and make the allowed set depend on installed packages; an empty checker plus `safe-url` is explicit. |
| Link check | A separate regex per field | Five copies drift. One function backs the schema format and the serializers. |

## Consequences

- An editor can store neither markup nor a script URL, whatever route the content takes in. The
  cost is that rich text has no inline marks or links until a block type adds them (a schema
  change, no migration).
- A theme author may use only the subset. A new keyword means a change to `SCHEMA_KEYWORDS`, to
  the dashboard's `SchemaFields` and to its test, in one PR.
- Switching theme re-validates `theme_config` but not stored sections. A section whose type the
  new theme lacks stays stored, and the renderer skips unknown types.
- `jsonschema` moves from a dev dependency to a runtime one.
