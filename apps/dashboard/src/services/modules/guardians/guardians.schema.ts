import { z } from "zod";

/**
 * The guardians module's Zod schemas — single source of truth for `GuardianFormDialog`
 * (Task 5, create/edit a guardian's own fields) and `GuardianPickerDialog`'s inline
 * create-tab (Task 6), so the same 5-field schema isn't redeclared in both places.
 */
export const guardianFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  alt_phone: z.string().optional(),
  email: z.string().optional(),
  photo_file_id: z.string().optional(),
});

export type GuardianFormValues = z.infer<typeof guardianFormSchema>;
