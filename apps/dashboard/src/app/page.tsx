import { redirect } from "next/navigation";

/** The app has no marketing root — send visitors to the dashboard (or /login via middleware). */
export default function RootPage() {
  redirect("/dashboard");
}
