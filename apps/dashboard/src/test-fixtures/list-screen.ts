import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/**
 * Helpers every list-screen test shares (Records, Corrections, and the lists after them): none
 * knows a domain. Each feature's support file keeps its fixtures, `asUser`, stub and render.
 */

/** A service function as the jest mock it is, so a test sets its return value. */
export const mocked = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

export const urlParam = (key: string) => new URLSearchParams(window.location.search).get(key);

/** The first argument of a mock's latest call: a list read's query. */
export function lastArg(fn: { mock: { calls: readonly (readonly unknown[])[] } }): unknown {
  return fn.mock.calls[fn.mock.calls.length - 1]?.[0];
}

/** A cursor list's implementation: `first` for any query, `second` for the one holding `c2`. */
export function cursorPages<P>(first: P, second: P) {
  return (query: { cursor?: string }) => Promise.resolve(query.cursor === "c2" ? second : first);
}

/** Queries within the table row that shows `name`. */
export function rowOf(name: string) {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
}

/** Opens the `combobox` select and picks `option`. */
export async function pick(
  user: ReturnType<typeof userEvent.setup>,
  combobox: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: combobox }));
  await user.click(await screen.findByRole("option", { name: option }));
}
