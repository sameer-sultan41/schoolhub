/** The upload purposes a guardian or student may use (`portal_uploadable` on the server). */
export const LEAVE_ATTACHMENT_PURPOSE = "attendance.leave-attachment";
export const THREAD_ATTACHMENT_PURPOSE = "communication.thread-attachment";

/** What both portal purposes accept (the server's registry is the authority). */
export const PORTAL_ATTACHMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const PORTAL_ATTACHMENT_MAX_MB = 10;
/** Files one message may carry from the portal: a UI cap, the server sets none. */
export const THREAD_ATTACHMENT_MAX_FILES = 5;

/** Website media (`apps/website_cms/uploads.py`): images on pages, news, events, the gallery and
 * SEO. Module-gated, so `GET /files` never lists them. */
export const WEBSITE_MEDIA_PURPOSE = "website.media";
export const WEBSITE_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
