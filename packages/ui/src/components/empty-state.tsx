import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  /** Rendered inside a recessed circle. Decorative — it is hidden from assistive tech. */
  icon: LucideIcon;
  /** What is not here, in the reader's terms: "No students yet", not "Empty result set". */
  title: string;
  /**
   * What to do about it. An empty screen is an invitation to act, so this says the next
   * step — "Add your first student, or import a class list." — rather than restating the
   * title. Required, and required in the caller's own words: this package has no i18n.
   */
  description: string;
  /** The primary action, if the viewer holds the permission for it. */
  action?: ReactNode;
  /**
   * `neutral` for "nothing here yet". `info` for "this is not built yet" — a module the
   * platform will have but does not today. The distinction matters: one is a state the
   * reader can change, the other is not, and rendering the second as an error (which is
   * what a 404 alert did) tells them something is broken when nothing is.
   */
  tone?: "neutral" | "info";
  className?: string;
}

/**
 * The one empty state in the system.
 *
 * Replaces the dashed-border box each list screen used to inline, which said "No students
 * found." and nothing else — a sentence that tells the reader only what they could
 * already see.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--sh-radius)] border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-11 items-center justify-center rounded-full",
          tone === "info" ? "bg-info/10 text-info" : "bg-surface-sunken text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-heading text-base font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
