import { set, type FieldErrors, type Resolver } from "react-hook-form";

import type { ApiError, PageSectionInput, PageSectionRecord, SectionType } from "@/services";
import {
  fromSchemaFormValues,
  schemaErrorPath,
  toSchemaFormValues,
  type SchemaFormValues,
} from "@/features/website/shared/schema-model";
import { schemaToZod, type SchemaMessages } from "@/features/website/shared/schema-zod";
import type { SectionTypes } from "./use-active-theme";

/**
 * The page editor's pure half: a page's sections as one form (every section's values held, the
 * edited one rendered), the `PATCH …/page-sections` body built from it, and a 422 keyed by JSON
 * path (`sections.2.items.0.answer`) mapped back onto the section it names.
 */

export interface SectionFormValue {
  /** The client's own key: the section's id once saved, a fresh one for a new section. Keys the
   * list row, the selection and the editor (so a late upload never lands in another section). */
  key: string;
  /** The saved section's id; absent for a new one. Not `id`: `useFieldArray` owns that name. */
  section_id?: string;
  section_type: SectionType;
  is_visible: boolean;
  /** Form values for a type the theme declares; the stored content, untouched, for one it
   * doesn't (sent back as it came). */
  content: SchemaFormValues;
}

export interface SectionsFormValues {
  sections: SectionFormValue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The page's saved sections (already in order) as the form's values. */
export function toSectionsFormValues(
  sections: readonly PageSectionRecord[],
  types: SectionTypes,
): SectionsFormValues {
  return {
    sections: sections.map((section) => {
      const type = types[section.section_type];
      return {
        key: section.id,
        section_id: section.id,
        section_type: section.section_type,
        is_visible: section.is_visible,
        content: type
          ? toSchemaFormValues(type.schema, section.content)
          : isRecord(section.content)
            ? section.content
            : {},
      };
    }),
  };
}

/** A new, visible section of `type` with empty content. */
export function newSection(type: SectionType, types: SectionTypes): SectionFormValue {
  return {
    key: `new-${crypto.randomUUID()}`,
    section_type: type,
    is_visible: true,
    content: toSchemaFormValues(types[type]?.schema ?? {}, {}),
  };
}

/** The `PATCH …/page-sections` body's list, in the form's order. */
export function toSectionsPayload(
  values: SectionsFormValues,
  types: SectionTypes,
): PageSectionInput[] {
  return values.sections.map((section) => {
    const type = types[section.section_type];
    return {
      ...(section.section_id ? { id: section.section_id } : {}),
      section_type: section.section_type,
      is_visible: section.is_visible,
      content: type ? fromSchemaFormValues(type.schema, section.content) : section.content,
    };
  });
}

/**
 * Checks every section against its own theme schema, not only the one on screen, so a save is
 * held until all are valid; errors land at `sections.<i>.content.<path>`. A section of a type
 * the theme doesn't declare is left to the server.
 */
export function sectionsResolver(
  types: SectionTypes,
  messages: SchemaMessages,
): Resolver<SectionsFormValues> {
  const checks = new Map(
    Object.entries(types).map(([type, entry]) => [type, schemaToZod(entry.schema, messages)]),
  );
  return (values) => {
    const errors: FieldErrors<SectionsFormValues> = {};
    let failed = false;
    for (const [index, section] of values.sections.entries()) {
      const result = checks.get(section.section_type)?.safeParse(section.content);
      if (!result || result.success) continue;
      for (const issue of result.error.issues) {
        failed = true;
        const path = ["sections", index, "content", ...issue.path.map(String)].join(".");
        set(errors, path, { type: issue.code, message: issue.message });
      }
    }
    return failed ? { values: {}, errors } : { values, errors: {} };
  };
}

/** The indexes of the sections that hold an error, from the form's own errors. */
export function sectionIndexesWithErrors(errors: FieldErrors<SectionsFormValues>): number[] {
  const sections = errors.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((entry: unknown, index) => (entry ? [index] : []));
}

export interface SectionErrorMapping {
  /** Errors with an input: the form path (`sections.1.content.items.0.answer`) and message. */
  fields: { path: string; message: string }[];
  /** Errors about a whole section (its type, its content as a whole), by section key. */
  sections: Record<string, string>;
  /** Errors about no single section (`file_id`, `sections`, `non_field`). */
  page: string[];
}

const SECTION_PATH = /^sections\.(\d+)(?:\.(.+))?$/;
/** A section's own keys, as the serializer names them; none has an input of its own. */
const SECTION_OWN_KEYS = new Set(["id", "section_type", "is_visible", "content"]);

function joinMessages(current: string | undefined, next: string): string {
  return current && current !== next ? `${current} ${next}` : next;
}

/**
 * Where each detail of a save's 422 belongs. Content errors are keyed by their JSON path inside
 * the section (`sections.<i>.<path>`; a serializer may write `sections.<i>.content.<path>`), and
 * land under the input `schemaErrorPath` finds; a path no input fits is the section's own
 * message; anything not under one section is the page's. `text` turns an issue into the
 * sentence shown (the reason translated).
 */
export function mapSectionErrors(
  error: ApiError,
  values: SectionsFormValues,
  types: SectionTypes,
  text: (issue: string) => string,
): SectionErrorMapping {
  const mapping: SectionErrorMapping = { fields: [], sections: {}, page: [] };
  for (const detail of error.details) {
    const message = text(detail.issue);
    const match = SECTION_PATH.exec(detail.field ?? "");
    const index = match ? Number(match[1]) : -1;
    const section = values.sections[index];
    if (!match || !section) {
      mapping.page.push(message);
      continue;
    }
    const schema = types[section.section_type]?.schema;
    let relative = match[2] ?? "";
    if (relative.startsWith("content.") && !schema?.properties?.content) {
      relative = relative.slice("content.".length);
    }
    const target =
      schema && relative !== "" && !SECTION_OWN_KEYS.has(relative)
        ? schemaErrorPath(schema, relative, section.content)
        : undefined;
    if (target === undefined) {
      mapping.sections[section.key] = joinMessages(mapping.sections[section.key], message);
    } else {
      mapping.fields.push({ path: `sections.${index}.content.${target}`, message });
    }
  }
  return mapping;
}
