import {
  DetailSkeleton,
  FormSkeleton,
  GridSkeleton,
  ScreenHeaderSkeleton,
  TableSkeleton,
} from "@schoolhub/ui";

/**
 * The four shapes every route-level `loading.tsx` under `(app)` is built from.
 *
 * Next renders a route's `loading.tsx` in place of the page while its async server
 * component resolves, so what it draws has to be the layout it is about to hand over to —
 * otherwise the page rearranges itself under the reader at the moment the data lands. The
 * group-level `(app)/loading.tsx` is still the fallback for a route that has none of its
 * own; a route defines one because a stat-tile grid is not what it renders.
 *
 * Twenty route files used to spell out that pairing one at a time, differing only in their
 * doc-comment prose. They now name a shape and pass the one thing that genuinely varies
 * between screens — a table's column count, a form's field count — and each of those
 * numbers is a claim about the screen it stands in for, so it stays with the route.
 */

/** A list screen: the filter row, a header row, and body rows. */
export function TableRouteLoading({ columns }: { columns: number }) {
  return (
    <div className="space-y-6">
      <ScreenHeaderSkeleton />
      <TableSkeleton columns={columns} />
    </div>
  );
}

/** A record screen: avatar, name, the tab strip, and the field pairs beneath it. */
export function DetailRouteLoading() {
  return (
    <div className="space-y-6">
      <ScreenHeaderSkeleton />
      <DetailSkeleton />
    </div>
  );
}

/** A create/edit screen: the fields, then the submit and cancel buttons. */
export function FormRouteLoading({ fields }: { fields: number }) {
  return (
    <div className="space-y-6">
      <ScreenHeaderSkeleton />
      <FormSkeleton fields={fields} />
    </div>
  );
}

/**
 * A week grid.
 *
 * Eight cells rather than `GridSkeleton`'s default four, and not a parameter: both
 * timetable screens draw a week, and a four-tile placeholder under a grid that arrives
 * with eight is precisely the jump these files exist to prevent.
 */
export function GridRouteLoading() {
  return (
    <div className="space-y-6">
      <ScreenHeaderSkeleton />
      <GridSkeleton count={8} />
    </div>
  );
}
