import { cn } from "@/lib/utils";
import { LoaderCircleIcon } from "lucide-react";

export function ContentLoader({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-full grow items-center justify-center", className)}>
      <div className="flex items-center gap-2.5">
        <LoaderCircleIcon className="animate-spin text-muted-foreground opacity-50" />
        <span className="text-sm font-medium text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}
