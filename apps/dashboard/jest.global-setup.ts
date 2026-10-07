/**
 * Runs once in Jest's own main process, before it forks any worker — see
 * https://jestjs.io/docs/configuration#globalsetup-string and `jest-config`'s own
 * description ("triggered once before all test suites"). `jest-config`/`@jest/core`
 * `require`+transpile this file directly in that main process (`runGlobalHook`), so
 * assigning `process.env.TZ` here mutates the REAL process environment — the one each
 * worker inherits when it is forked afterward.
 *
 * This is deliberately NOT the same as setting `process.env.TZ` inside a running test
 * (e.g. a `beforeAll`): a test file executes inside a Jest-sandboxed environment whose
 * `process.env` is a Proxy over a snapshot copy (`jest-util`'s `createProcessObject`/
 * `createProcessEnv`) — mutating it there never reaches Node's real timezone state, so
 * `Date`/`Intl` formatting is unaffected no matter what the test sets.
 *
 * America/New_York (UTC-5 in January, no DST) is a real negative-UTC-offset zone.
 * CI (`ubuntu-latest`) runs with no `TZ` set, i.e. UTC, where a date-only-string
 * timezone bug (parsing as UTC midnight vs. local midnight) can't be told apart from
 * the fix — this makes every dashboard test run somewhere that bug is observable.
 */
export default function globalSetup(): void {
  process.env.TZ = "America/New_York";
}
