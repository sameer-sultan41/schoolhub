import { z } from "zod";

import { DOMAIN_INPUT_MAX_LENGTH } from "./custom-domains-constant";

/** The add form's messages, translated by the caller. */
export interface CustomDomainFormMessages {
  required: string;
  tooLong: string;
}

/** The add form: required after trimming, and no longer than the server reads. Whether the name
 * is a valid domain is the server's call (`invalid_domain`, `platform_domain`). */
export function customDomainFormSchema(messages: CustomDomainFormMessages) {
  return z.object({
    domain: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(DOMAIN_INPUT_MAX_LENGTH, messages.tooLong),
  });
}

export type CustomDomainFormValues = z.infer<ReturnType<typeof customDomainFormSchema>>;
