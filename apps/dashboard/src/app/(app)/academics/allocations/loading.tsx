import { TableRouteLoading } from "@/components/route-loading";

/**
 * The allocation table: section, subject, teacher, role, weekly periods,
 * effective dates and row actions.
 */
export default function Loading() {
  return <TableRouteLoading columns={7} />;
}
