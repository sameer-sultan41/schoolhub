import { ChangePasswordForm } from "./change-password-form";
import { PortalPreferences } from "./portal-preferences";

/** `/portal/settings`: notification preferences and the password. Each section loads and fails
 * on its own, so a preferences load error never hides the password form. */
export function PortalSettings() {
  return (
    <div className="space-y-8">
      <PortalPreferences />
      <ChangePasswordForm />
    </div>
  );
}
