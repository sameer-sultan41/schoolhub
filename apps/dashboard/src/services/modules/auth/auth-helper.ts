/**
 * The auth module's pure helper functions — intentionally empty. Every function in
 * `auth-service.ts` is an API call with a side effect (token store, cookie), not a
 * pure mapper/formatter, so there is nothing to extract here yet. Per ADR-0019,
 * this file stays as part of `auth`'s standard shape regardless; add a function
 * here, not inline in a feature file, the first time a real pure helper is needed.
 */
export {};
