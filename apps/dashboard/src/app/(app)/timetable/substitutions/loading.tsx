import { TableRouteLoading } from "@/components/route-loading";

/**
 * The substitutions table: date, absent teacher, substitute, reason, status
 * and the decision buttons.
 */
export default function Loading() {
  return <TableRouteLoading columns={6} />;
}
