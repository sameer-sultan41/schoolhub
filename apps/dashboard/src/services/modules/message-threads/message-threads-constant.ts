/** The message-threads module's constants. */

/** The query-key module every inbox and conversation read lives under; a post invalidates it. */
export const MESSAGE_THREADS_QUERY_MODULE = "message-threads";

/** A message body's longest length (the server's `MESSAGE_BODY_MAX_LENGTH`). */
export const MESSAGE_BODY_MAX_LENGTH = 5000;
/** A thread subject's longest length. */
export const THREAD_SUBJECT_MAX_LENGTH = 200;
/** The inbox's page size. */
export const THREADS_PAGE_SIZE = 20;
/** A conversation page's size: newest first, so "Load earlier" reads the next page. */
export const MESSAGES_PAGE_SIZE = 30;
/** Participants a `group` thread needs, and the one an `internal` thread has. */
export const GROUP_MIN_PARTICIPANTS = 2;
export const INTERNAL_PARTICIPANTS = 1;
