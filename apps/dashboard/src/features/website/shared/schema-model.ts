import { rekeyFieldErrors, NON_FIELD } from "@/lib/error-message";
import type { JsonSchema } from "@/services";
import { toRichText, toRichTextPayload } from "./rich-text";

/**
 * The pure half of `SchemaFields` (decision 12): how a theme section's JSON Schema maps to
 * form values and back, and how a server 422 keyed by JSON path finds its input. Only the
 * constrained subset of decision 6 is read; any other keyword is ignored.
 */

export type FieldKind =
  | "text"
  | "textarea"
  | "url"
  | "image"
  | "rich-text"
  | "select"
  | "number"
  | "boolean"
  | "object"
  | "object-array"
  | "string-array";

export function fieldKind(prop: JsonSchema): FieldKind {
  const widget = prop["x-widget"];
  if (prop.$ref !== undefined || widget === "rich-text") return "rich-text";
  if (widget === "image") return "image";
  if (prop.enum) return "select";
  switch (prop.type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    case "array":
      return prop.items?.type === "object" || prop.items?.properties
        ? "object-array"
        : "string-array";
    default:
      break;
  }
  if (widget === "textarea") return "textarea";
  if (widget === "url" || prop.format === "safe-url") return "url";
  return "text";
}

export type SchemaFormValues = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function properties(schema: JsonSchema): [string, JsonSchema][] {
  return Object.entries(schema.properties ?? {});
}

/** A `path.to.field` under `prefix` (no leading dot when the prefix is empty). */
export function joinPath(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** Whether `value` has a control character or a space (U+0000 to U+0020, U+007F): never valid
 * in a link. */
function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A form value as an input's text: anything that isn't a string is empty. */
export function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `https:` URLs and `/`-relative paths only: the client mirror of the server's `safe-url`. */
export function isSafeUrl(value: string): boolean {
  if (value === "" || hasControlOrSpace(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.startsWith("/\\");
  if (value.includes("\\")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

function toFormValue(prop: JsonSchema, value: unknown): unknown {
  switch (fieldKind(prop)) {
    case "rich-text":
      return toRichText(value);
    case "boolean":
      return value === true;
    case "number":
      return typeof value === "number" ? String(value) : "";
    case "object":
      return toSchemaFormValues(prop, value);
    case "object-array":
      return Array.isArray(value)
        ? value.map((item) => toSchemaFormValues(prop.items ?? {}, item))
        : [];
    case "string-array":
      return Array.isArray(value) ? value.map((item) => String(item)) : [];
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
}

/** Stored content as form values: every property present, empty ones as `""`, `false`, `[]`
 * or the empty rich-text document. */
export function toSchemaFormValues(schema: JsonSchema, content: unknown): SchemaFormValues {
  const source = isRecord(content) ? content : {};
  return Object.fromEntries(
    properties(schema).map(([key, prop]) => [key, toFormValue(prop, source[key])]),
  );
}

function fromFormValue(prop: JsonSchema, value: unknown, isRequired: boolean): unknown {
  switch (fieldKind(prop)) {
    case "rich-text":
      return toRichTextPayload(toRichText(value));
    case "boolean":
      return value === true;
    case "number": {
      const text = typeof value === "string" ? value.trim() : "";
      return text === "" ? undefined : Number(text);
    }
    case "object":
      return fromSchemaFormValues(prop, isRecord(value) ? value : {});
    case "object-array":
      return Array.isArray(value)
        ? value.map((item) => fromSchemaFormValues(prop.items ?? {}, isRecord(item) ? item : {}))
        : [];
    case "string-array":
      return Array.isArray(value) ? value.map((item) => String(item)) : [];
    case "image":
      // "No image" omits the key: the API refuses an empty file id.
      return typeof value === "string" && value !== "" ? value : undefined;
    case "select": {
      const text = typeof value === "string" ? value : "";
      if (text === "") return undefined;
      return prop.enum?.find((option) => String(option) === text) ?? text;
    }
    default: {
      const text = typeof value === "string" ? value : "";
      return text === "" && !isRequired ? undefined : text;
    }
  }
}

/** Form values as the content the API takes: an empty optional value is left out. */
export function fromSchemaFormValues(
  schema: JsonSchema,
  values: SchemaFormValues,
): SchemaFormValues {
  const required = new Set(schema.required ?? []);
  const out: SchemaFormValues = {};
  for (const [key, prop] of properties(schema)) {
    const value = fromFormValue(prop, values[key], required.has(key));
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The rich-text block keys with an input of their own. */
const BLOCK_INPUT_KEYS = new Set(["text", "level", "ordered", "items", "file_id", "alt"]);

function isIndex(part: string | undefined, list: unknown): part is string {
  if (part === undefined || !/^\d+$/.test(part)) return false;
  return !Array.isArray(list) || Number(part) < list.length;
}

function resolveInObject(schema: JsonSchema, parts: string[], values: unknown): string[] | null {
  const [key, ...rest] = parts;
  const prop = key === undefined ? undefined : schema.properties?.[key];
  if (key === undefined || !prop) return null;
  const tail = resolveInProperty(prop, rest, isRecord(values) ? values[key] : undefined);
  return tail === null ? null : [key, ...tail];
}

function resolveInProperty(prop: JsonSchema, rest: string[], value: unknown): string[] | null {
  const kind = fieldKind(prop);
  if (kind === "object") return rest.length === 0 ? null : resolveInObject(prop, rest, value);
  if (rest.length === 0) return [];
  const [index, ...tail] = rest;
  switch (kind) {
    case "object-array": {
      if (!isIndex(index, value) || tail.length === 0) return [];
      const item = Array.isArray(value) ? (value as unknown[])[Number(index)] : undefined;
      const inner = resolveInObject(prop.items ?? {}, tail, item);
      return inner === null ? [] : [index, ...inner];
    }
    case "string-array":
      return isIndex(index, value) ? [index] : [];
    case "rich-text": {
      // `blocks.<i>.<key>` lands under that block's input when the block has one; anything
      // else (`blocks`, `blocks.<i>`, a key the block lacks) under the editor itself.
      const blocks = isRecord(value) ? value.blocks : undefined;
      const [key] = tail;
      if (index !== "blocks" || !isIndex(key, blocks)) return [];
      const block = Array.isArray(blocks) ? (blocks as unknown[])[Number(key)] : undefined;
      const field = tail[1];
      if (field === undefined || !BLOCK_INPUT_KEYS.has(field)) return [];
      if (isRecord(block) && !(field in block)) return [];
      return ["blocks", key, field];
    }
    default:
      // A leaf input: anything deeper is still that input's error.
      return [];
  }
}

/**
 * The form path, relative to the schema's own values, of the input a server error keyed by
 * `path` (`items.1.answer`) belongs under; `undefined` when no input fits (the error is then
 * the form's own message). With `values`, an index past the end lands on its list instead.
 */
export function schemaErrorPath(
  schema: JsonSchema,
  path: string,
  values?: SchemaFormValues,
): string | undefined {
  if (path === "" || path === NON_FIELD) return undefined;
  const resolved = resolveInObject(schema, path.split("."), values);
  return resolved === null ? undefined : resolved.join(".");
}

export interface RekeySchemaErrorsOptions {
  schema: JsonSchema;
  /** The current form values under `fieldPrefix`, so a stale index never targets nothing. */
  values?: SchemaFormValues;
  /** Where the server keys this content, e.g. `sections.2` (empty: at the root). */
  serverPrefix?: string;
  /** Where the form holds it, e.g. `content` (empty: at the root). */
  fieldPrefix?: string;
}

/**
 * Re-keys a 422's JSON-path field errors onto the form's own paths, and lists them, for
 * `applyServerFieldErrors`' `knownFields`. A detail outside `serverPrefix`, or with no input
 * to land on, keeps its key, so it folds into the form's own message.
 */
export function rekeySchemaErrors(
  error: unknown,
  { schema, values, serverPrefix = "", fieldPrefix = "" }: RekeySchemaErrorsOptions,
): { error: unknown; fields: string[] } {
  const fields: string[] = [];
  const rekeyed = rekeyFieldErrors(error, (field) => {
    let relative: string;
    if (!serverPrefix) relative = field;
    else if (field.startsWith(`${serverPrefix}.`)) relative = field.slice(serverPrefix.length + 1);
    else return undefined;
    const target = schemaErrorPath(schema, relative, values);
    if (target === undefined) return undefined;
    const full = joinPath(fieldPrefix, target);
    fields.push(full);
    return full;
  });
  return { error: rekeyed, fields };
}
