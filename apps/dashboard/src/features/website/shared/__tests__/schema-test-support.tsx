import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { Button, Form } from "@schoolhub/ui";

import { applyServerFieldErrors, foldUnknownFieldErrors } from "@/lib/error-message";
import type { JsonSchema } from "@/services";

import { SchemaFields, useSchemaMessages } from "../schema-fields";
import {
  fromSchemaFormValues,
  rekeySchemaErrors,
  toSchemaFormValues,
  type SchemaFormValues,
} from "../schema-model";
import { schemaToZod } from "../schema-zod";
import { submitAfterUploads, UploadTrackerProvider, useUploadTracker } from "../upload-tracker";

/** A page editor's section, as the tests drive it: `content` holds the section's values, the
 * server keys its errors under `sections.0`. */
interface HostValues {
  content: SchemaFormValues;
}

export interface SchemaHostProps {
  schema: JsonSchema;
  content?: unknown;
  /** Receives the content as the API would; reject to simulate a 422. */
  onSave: (content: SchemaFormValues) => Promise<void>;
}

/** A host form around `SchemaFields`, wired the way a real editor is: the runtime zod resolver,
 * the upload tracker, the payload builder and the 422 mapping. */
export function SchemaHost({ schema, content, onSave }: SchemaHostProps) {
  const messages = useSchemaMessages();
  const tErrors = useTranslations("errors");
  const tracker = useUploadTracker();
  const [formError, setFormError] = useState<string | null>(null);
  const resolver = useMemo(
    () =>
      zodResolver(
        z.object({ content: schemaToZod(schema, messages) }),
      ) as unknown as Resolver<HostValues>,
    [schema, messages],
  );
  const form = useForm<HostValues>({
    resolver,
    defaultValues: { content: toSchemaFormValues(schema, content) },
  });

  const save = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSave(fromSchemaFormValues(schema, values.content));
    } catch (error) {
      const mapped = rekeySchemaErrors(error, {
        schema,
        values: values.content,
        serverPrefix: "sections.0",
        fieldPrefix: "content",
      });
      applyServerFieldErrors({
        error: foldUnknownFieldErrors(mapped.error, mapped.fields),
        form,
        knownFields: mapped.fields,
        tErrors,
        fallback: "Save failed.",
        setFormError,
      });
    }
  });

  return (
    <UploadTrackerProvider value={tracker}>
      <Form {...form}>
        <form
          noValidate
          onSubmit={submitAfterUploads(tracker, (event) => {
            void save(event);
          })}
        >
          <SchemaFields form={form} schema={schema} name="content" />
          {formError ? <p data-testid="form-error">{formError}</p> : null}
          <Button type="submit" disabled={tracker.isUploading}>
            Save
          </Button>
        </form>
      </Form>
    </UploadTrackerProvider>
  );
}

/** A theme section with one of every widget the subset allows, plus keywords it doesn't. */
export const KITCHEN_SINK = {
  type: "object",
  properties: {
    heading: { type: "string", maxLength: 20, minLength: 1, "x-widget": "text" },
    intro: { type: "string", maxLength: 500, "x-widget": "textarea" },
    cta_href: { type: "string", format: "safe-url", "x-widget": "url" },
    image_file_id: { type: "string", minLength: 36, maxLength: 36, "x-widget": "image" },
    body: { $ref: "rich_text.json", "x-widget": "rich-text" },
    form: { type: "string", enum: ["contact", "admission_enquiry"] },
    limit: { type: "integer", minimum: 1, maximum: 60 },
    featured: { type: "boolean" },
    tags: { type: "array", items: { type: "string", maxLength: 30 } },
    // Outside the subset: never enforced, never a crash.
    nickname: { type: "string", pattern: "^z", "x-widget": "colour-picker", "x-unknown": true },
  },
  required: ["heading"],
  "x-theme-note": "ignored",
} as unknown as JsonSchema;

export const FAQ = {
  type: "object",
  properties: {
    heading: { type: "string", maxLength: 200, "x-widget": "text" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string", maxLength: 300, minLength: 1, "x-widget": "text" },
          answer: { type: "string", maxLength: 2000, minLength: 1, "x-widget": "textarea" },
        },
        required: ["question", "answer"],
      },
    },
  },
  required: ["items"],
} as JsonSchema;

export const HERO = {
  type: "object",
  properties: {
    heading: { type: "string", maxLength: 200, minLength: 1, "x-widget": "text" },
    image_file_id: { type: "string", minLength: 36, maxLength: 36, "x-widget": "image" },
    image_alt: { type: "string", maxLength: 200, "x-widget": "text" },
  },
  required: ["heading"],
} as JsonSchema;

export const FILE_ID = "0b5e9a64-1f7c-4d3a-9b0e-2f1c6d7a8e90";
