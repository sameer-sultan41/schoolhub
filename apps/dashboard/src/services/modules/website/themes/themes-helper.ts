import type { JsonSchema, ThemeRecord, ThemeSectionType } from "./themes-type";

/** The themes domain's pure helpers. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A theme's JSON narrowed to the schema subset; anything that isn't an object is no schema. */
export function asJsonSchema(value: unknown): JsonSchema {
  return isRecord(value) ? value : {};
}

/** A theme's `section_types` (`{type: {label, schema}}`) as typed entries; malformed ones are
 * skipped rather than crashing the editor. */
export function themeSectionTypes(theme: ThemeRecord): Record<string, ThemeSectionType> {
  const raw = theme.section_types;
  if (!isRecord(raw)) return {};
  const out: Record<string, ThemeSectionType> = {};
  for (const [type, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || !isRecord(entry.schema)) continue;
    out[type] = {
      label: typeof entry.label === "string" ? entry.label : type,
      schema: asJsonSchema(entry.schema),
    };
  }
  return out;
}
