"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { rekeyFieldErrors } from "@/lib/error-message";
import type { JsonSchema } from "@/services";
import { CONTENT_REASON_SCOPE } from "./content-fields";
import { withReasonText } from "./reason-message";
import { rekeySchemaErrors } from "./schema-model";

/**
 * A news `body` or event `description` 422, moved under the input it is about. The API checks
 * the document on its own, so its errors are keyed inside it (`blocks.2.text`); they move under
 * `name` and through the block-path resolution the section editor uses (an index past the end,
 * or a key with no input, lands on the editor). Returns the error and the fields it now names.
 */
export function rekeyRichTextErrors(
  error: unknown,
  name: string,
  doc: unknown,
): { error: unknown; fields: string[] } {
  const prefixed = rekeyFieldErrors(error, (field) =>
    field === "blocks" || field.startsWith("blocks.") ? `${name}.${field}` : undefined,
  );
  // One rich-text property: `$ref` is all the resolution reads to treat it as a document.
  const schema: JsonSchema = { type: "object", properties: { [name]: { $ref: "rich_text.json" } } };
  return rekeySchemaErrors(prefixed, { schema, values: { [name]: doc } });
}

export interface ContentFormSubmitOptions<TValues extends FieldValues, TResult> {
  form: UseFormReturn<TValues>;
  save: (values: TValues) => Promise<TResult>;
  /** The form's own inputs, which a server error may name. */
  fields: readonly string[];
  /** The rich-text field, whose errors arrive keyed inside the document. */
  richTextName?: string;
  onSuccess: (result: TResult) => void;
}

/**
 * The submit of a news, event or album form: `useFormDialogSubmit`, with every business-rule
 * refusal in the viewer's language and a rich-text error under its block's input. Anything no
 * input fits is the form's own message, never swallowed.
 */
export function useContentFormSubmit<TValues extends FieldValues, TResult>({
  form,
  save,
  fields,
  richTextName,
  onSuccess,
}: ContentFormSubmitOptions<TValues, TResult>) {
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  // The block inputs the last refusal named; read when that refusal is mapped.
  const richTextFields = useRef<string[]>([]);

  return useFormDialogSubmit({
    form,
    mutationFn: async (values: TValues) => {
      try {
        return await save(values);
      } catch (failure) {
        const localised = withReasonText(failure, tReasons, CONTENT_REASON_SCOPE);
        if (richTextName === undefined) throw localised;
        const doc: unknown = values[richTextName];
        const rekeyed = rekeyRichTextErrors(localised, richTextName, doc);
        richTextFields.current = rekeyed.fields;
        throw rekeyed.error;
      }
    },
    knownFields: () => [...fields, ...richTextFields.current],
    onSuccess,
    fallbackMessage: tCommon("submitFailed"),
  });
}
