/** The fragment keys an invitation link carries: `/accept-invite#school=<slug>&token=…`. */
export const INVITATION_LINK_KEYS = ["school", "token"] as const;

/** The fragment keys a reset link carries: `/reset-password#school=<slug>&uid=…&token=…`. */
export const RESET_LINK_KEYS = ["school", "uid", "token"] as const;

/** The shortest password the server takes: mirrors `MinimumLengthValidator`'s `min_length` in
 * `apps/api/config/settings/base.py`, which `ChangePasswordSerializer.new_password` also applies. */
export const PASSWORD_MIN_LENGTH = 10;

/** The 400 code every unusable emailed link gets (`core/api/exceptions.py`'s `InvalidLink`). */
export const INVALID_LINK_CODE = "invalid_link";
