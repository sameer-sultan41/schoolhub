import { ApiError } from "@schoolhub/api-client";
import { INVALID_LINK_CODE } from "./auth-constant";

/** The link values a malformed link fails validation on, before the token is checked. */
const LINK_FIELDS = ["school", "uid", "token"];

/**
 * Reads `keys` out of a URL fragment (`#school=demo&token=…`). Returns `null` unless every
 * key is present and non-empty: a link missing any part is as unusable as a wrong one.
 */
export function readLinkFragment<const TKey extends string>(
  hash: string,
  keys: readonly TKey[],
): Record<TKey, string> | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const values = {} as Record<TKey, string>;
  for (const key of keys) {
    const value = params.get(key);
    if (!value) return null;
    values[key] = value;
  }
  return values;
}

/**
 * Whether a failed link request means the link itself is unusable: the API's
 * `invalid_link`, or a `validation_error` on a link value (a truncated or edited link
 * fails the serializer before the token is looked up). A weak password is neither.
 */
export function isUnusableLinkError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === INVALID_LINK_CODE) return true;
  const fields = Object.keys(error.fieldErrors());
  return error.code === "validation_error" && fields.some((field) => LINK_FIELDS.includes(field));
}
