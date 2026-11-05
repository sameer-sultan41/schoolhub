import type { ReactNode } from "react";

/** The title and intro line every auth card opens with. */
export function AuthPageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h1 className="font-heading text-lg font-semibold text-foreground">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
