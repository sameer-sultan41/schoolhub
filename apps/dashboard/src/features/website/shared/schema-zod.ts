import { z } from "zod";

import type { JsonSchema } from "@/services";
import { richTextSchema } from "./rich-text";
import { fieldKind, isSafeUrl } from "./schema-model";

/**
 * The zod schema `SchemaFields`' values are checked with, built at runtime from a theme
 * section's JSON Schema (decision 12), over the form-value shapes of `schema-model.ts`
 * (numbers as text, empty as `""`). The server re-validates everything against the theme.
 */

export interface SchemaMessages {
  required: string;
  tooLong: (max: number) => string;
  tooShort: (min: number) => string;
  notANumber: string;
  notAWholeNumber: string;
  tooSmall: (min: number) => string;
  tooLarge: (max: number) => string;
  unsafeUrl: string;
  notAnOption: string;
  imageRequired: string;
}

function stringZod(prop: JsonSchema, isRequired: boolean, messages: SchemaMessages) {
  const isUrl = fieldKind(prop) === "url";
  return z.string().superRefine((value, ctx) => {
    if (value === "") {
      // An empty optional value is left out of the content; an empty required one with a
      // minimum length would be refused.
      if (isRequired && (prop.minLength ?? 0) > 0) {
        ctx.addIssue({ code: "custom", message: messages.required });
      }
      return;
    }
    if (prop.minLength !== undefined && value.length < prop.minLength) {
      ctx.addIssue({ code: "custom", message: messages.tooShort(prop.minLength) });
    }
    if (prop.maxLength !== undefined && value.length > prop.maxLength) {
      ctx.addIssue({ code: "custom", message: messages.tooLong(prop.maxLength) });
    }
    if (isUrl && !isSafeUrl(value)) ctx.addIssue({ code: "custom", message: messages.unsafeUrl });
  });
}

function numberZod(prop: JsonSchema, isRequired: boolean, messages: SchemaMessages) {
  return z.string().superRefine((raw, ctx) => {
    const text = raw.trim();
    if (text === "") {
      if (isRequired) ctx.addIssue({ code: "custom", message: messages.required });
      return;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      ctx.addIssue({ code: "custom", message: messages.notANumber });
      return;
    }
    if (prop.type === "integer" && !Number.isInteger(value)) {
      ctx.addIssue({ code: "custom", message: messages.notAWholeNumber });
    }
    if (prop.minimum !== undefined && value < prop.minimum) {
      ctx.addIssue({ code: "custom", message: messages.tooSmall(prop.minimum) });
    }
    if (prop.maximum !== undefined && value > prop.maximum) {
      ctx.addIssue({ code: "custom", message: messages.tooLarge(prop.maximum) });
    }
  });
}

function selectZod(prop: JsonSchema, isRequired: boolean, messages: SchemaMessages) {
  const options = (prop.enum ?? []).map(String);
  return z.string().superRefine((value, ctx) => {
    if (value === "") {
      if (isRequired) ctx.addIssue({ code: "custom", message: messages.required });
      return;
    }
    if (!options.includes(value)) ctx.addIssue({ code: "custom", message: messages.notAnOption });
  });
}

function propertyZod(prop: JsonSchema, isRequired: boolean, messages: SchemaMessages): z.ZodType {
  switch (fieldKind(prop)) {
    case "rich-text":
      return richTextSchema(messages);
    case "image":
      return isRequired ? z.string().min(1, messages.imageRequired) : z.string();
    case "boolean":
      return z.boolean();
    case "number":
      return numberZod(prop, isRequired, messages);
    case "select":
      return selectZod(prop, isRequired, messages);
    case "object":
      return schemaToZod(prop, messages);
    case "object-array":
      return z.array(schemaToZod(prop.items ?? {}, messages));
    case "string-array":
      return z.array(stringZod(prop.items ?? {}, false, messages));
    default:
      return stringZod(prop, isRequired, messages);
  }
}

/** The zod object for one schema's form values; unknown keywords are ignored. */
export function schemaToZod(schema: JsonSchema, messages: SchemaMessages) {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    shape[key] = propertyZod(prop, required.has(key), messages);
  }
  // Loose: a stored key the schema doesn't declare passes through, so a host whose resolver
  // returns the parsed values still sends it back (`fromSchemaFormValues`).
  return z.looseObject(shape);
}
