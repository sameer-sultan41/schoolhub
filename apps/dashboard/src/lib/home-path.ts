import { Paths } from "@/config/paths";

/** The landing page for a signed-in user: a student or guardian (`/auth/me`'s
 * `is_restricted_principal`) lands on the portal, everyone else on the staff dashboard. */
export function homePathFor(user: { is_restricted_principal?: boolean }): string {
  return user.is_restricted_principal === true ? Paths.PORTAL : Paths.DASHBOARD;
}
