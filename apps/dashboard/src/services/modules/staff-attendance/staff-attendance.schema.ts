import { z } from "zod";

/**
 * The check-out form, with the API's own field name so a server error lands under its input.
 * The register's rows are not a Zod form: each is local state, saved on its own.
 */

export type CheckOutFormMessages = Record<"required" | "notAfterCheckIn", string>;

/** `checkInTime` is the row's `HH:MM`; check-out must be later (§11), as the server checks. */
export function createCheckOutFormSchema(messages: CheckOutFormMessages, checkInTime: string) {
  return z.object({
    check_out_time: z
      .string()
      .refine((value) => value !== "", messages.required)
      // `HH:MM` strings order as the times do.
      .refine((value) => value === "" || value > checkInTime, messages.notAfterCheckIn),
  });
}

export type CheckOutFormValues = z.infer<ReturnType<typeof createCheckOutFormSchema>>;
