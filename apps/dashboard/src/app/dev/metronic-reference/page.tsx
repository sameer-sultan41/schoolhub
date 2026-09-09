import { notFound } from "next/navigation";
import { MetronicReferenceShell } from "./_metronic/shell";

/**
 * A temporary, dev-only visual reference: schoolhub's own navigation rendered through
 * Metronic's own header/sidebar structure and classNames (copied from
 * `/Users/avialdo/Documents/metronic nextjs/app/components/layouts/demo1`, not
 * reinterpreted), so the real dashboard shell (`apps/dashboard/src/components/app-shell.tsx`)
 * can be checked against a faithful, live Metronic render instead of a screenshot or
 * memory of one. Not linked from any nav, not part of the shipped product surface, and
 * 404s outside development — delete this whole `dev/metronic-reference` route once the
 * real shell's styling is settled.
 */
export default function MetronicReferencePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <MetronicReferenceShell>
      <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Today at a glance</p>
      <div className="mt-6 grid grid-cols-1 gap-4 bg-card sm:grid-cols-3">
        {["Students", "Staff", "Attendance"].map((label) => (
          <div key={label} className="rounded-lg border border-border bg-background p-4">
            <div className="text-xs text-muted-foreground uppercase">{label}</div>
            <div className="mt-2 text-2xl font-semibold">—</div>
          </div>
        ))}
      </div>
    </MetronicReferenceShell>
  );
}
