import { Avatar, AvatarFallback } from "@schoolhub/ui";
import { initialsFor } from "@/lib/names";

/**
 * A person in a table row: initials avatar, name, and one muted line beneath.
 *
 * Initials rather than photographs, and not as a placeholder for them: a list response
 * carries `photo_file_id`, not a URL, and the only way to a URL is a presigned POST per
 * file — so a 25-row roster would fire 25 requests to render its first column. Initials
 * cost nothing, survive an offline cache, and read as a deliberate treatment rather than
 * as images that failed to load.
 *
 * The name is a single text node on purpose. Splitting it across elements to style parts
 * of it would break every `getByText("Amina Khan")` in the suite and, more importantly,
 * hand a screen reader two fragments where a person has one name.
 *
 * `secondary` is where the row's identifier goes — an admission number, an employee
 * number, an email. It is the column that used to hold that value on its own; folding it
 * under the name buys back a whole column of width and keeps the two together, which is
 * how someone reads them anyway.
 */
export function PersonCell({ name, secondary }: { name: string; secondary?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-8 shrink-0">
        {/* aria-hidden: the name is right there in the next element, and a screen reader
            announcing "AK" before it is noise, not information. */}
        <AvatarFallback aria-hidden="true">{initialsFor(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        {secondary ? (
          <span className="truncate font-numeric text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </div>
    </div>
  );
}
