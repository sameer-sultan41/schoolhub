import { TableRouteLoading } from "@/components/route-loading";

/**
 * The bell schedule: sequence, name, time, campus, weekdays, kind and row
 * actions.
 */
export default function Loading() {
  return <TableRouteLoading columns={7} />;
}
