import { TableRouteLoading } from "@/components/route-loading";

/**
 * The rooms table: code, name, type, campus, capacity, location, status and
 * row actions.
 */
export default function Loading() {
  return <TableRouteLoading columns={8} />;
}
