import { Paths } from "@/config/paths";

/** The landing page for a signed-in user: a platform operator (`/auth/me`'s `is_platform`) lands
 * on the console, a student or guardian (`is_restricted_principal`) on the portal, everyone else
 * on the staff dashboard. A platform account has no school, so it never has either other home. */
export function homePathFor(user: {
  is_restricted_principal?: boolean;
  is_platform?: boolean;
}): string {
  if (user.is_platform === true) return Paths.PLATFORM;
  return user.is_restricted_principal === true ? Paths.PORTAL : Paths.DASHBOARD;
}
