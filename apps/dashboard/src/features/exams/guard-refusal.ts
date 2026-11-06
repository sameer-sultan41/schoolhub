import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { keepServerMessage } from "@/lib/keep-server-message";
import { ApiError } from "@/services";

/**
 * Runs an exam write; when the server refuses it with a 409 because of the exam's own state
 * ("its configuration is frozen", "only a draft can be deleted"), calls `onRefused` (reload the
 * exam, which has moved on) and rethrows with the server's sentence kept as the message, since
 * the generic `errors.conflict` text would replace it. Any other error is rethrown as it is: a
 * 422 reaches `useFormDialogSubmit` / `useConfirmAction`, which map field errors and fold the rest.
 */
export async function guardRefusal<T>(write: () => Promise<T>, onRefused: () => void): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) {
      onRefused();
      throw keepServerMessage(error);
    }
    throw error;
  }
}
