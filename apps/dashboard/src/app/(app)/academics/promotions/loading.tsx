import { TableRouteLoading } from "@/components/route-loading";

/** The batch table: batch id, class, session pair, student count and status. */
export default function Loading() {
  return <TableRouteLoading columns={5} />;
}
