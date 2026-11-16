import type { WebsiteContentStatus } from "@/services";

/**
 * Whether a viewer may change a website record now. A published record is changed only by a
 * holder of its kind's `.publish` key: the publish gate is the approval (module doc §7.1), and
 * the API refuses anyone else with 422 `publish_required` (`content.py::assert_may_edit`).
 */
export function canEditContent(
  status: WebsiteContentStatus,
  canUpdate: boolean,
  canPublish: boolean,
): boolean {
  return canUpdate && (status !== "published" || canPublish);
}

/** A viewer who could edit the record were it not live: shown why it is read-only. */
export function isPublisherOnly(
  status: WebsiteContentStatus,
  canUpdate: boolean,
  canPublish: boolean,
): boolean {
  return canUpdate && !canEditContent(status, canUpdate, canPublish);
}
