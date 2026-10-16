import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * Renders once the signed-in user has loaded, so a test asserting something is absent isn't just
 * "too early". Mount it beside the component under test and `await screen.findByText(USER_LOADED)`.
 */
export const USER_LOADED = "user loaded";

export function UserLoaded() {
  const { data } = useCurrentUser();
  return data ? <p>{USER_LOADED}</p> : null;
}
