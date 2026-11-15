import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). `config_schema` and `section_types` arrive as JSON. */
export type ThemeRecord = ApiSchemas["Theme"];

/** The widget hint a theme schema may give a property (decision 6). */
export type SchemaWidget = "text" | "textarea" | "image" | "rich-text" | "url";

/**
 * The constrained JSON Schema subset a theme declares its sections in (decision 6). Not a wire
 * shape: the generated type is `unknown`, and `themes-helper.ts` narrows it to this.
 */
export interface JsonSchema {
  type?: "object" | "string" | "integer" | "number" | "boolean" | "array";
  title?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  $ref?: string;
  "x-widget"?: SchemaWidget;
}

/** One section type a theme offers: its label and its content schema. */
export interface ThemeSectionType {
  label: string;
  schema: JsonSchema;
}
