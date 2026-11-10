"use client";

import { createContext, useContext } from "react";

/** The kinds of record a table cell names by id. */
export type NameKind =
  "accounts" | "sessions" | "classes" | "campuses" | "structures" | "heads" | "categories";

export type NameLookups = Partial<Record<NameKind, ReadonlyMap<string, string>>>;

const NameLookupContext = createContext<NameLookups>({});

/**
 * Supplies the id-to-name maps a table's cells show. A cell reads them through
 * `LookedUpName`, so the names arriving (a ledger or reference read that lands after the rows)
 * re-renders the cell and never rebuilds the table's columns, whose cells would otherwise
 * remount, taking a row's buttons from under a click.
 */
export const NameLookupProvider = NameLookupContext.Provider;

/** A record's name by id, or `fallback` while the list is unread, unreadable or lacks the id. */
export function LookedUpName({
  kind,
  id,
  fallback,
}: {
  kind: NameKind;
  id: string;
  fallback: string;
}) {
  const lookups = useContext(NameLookupContext);
  return <>{lookups[kind]?.get(id) ?? fallback}</>;
}
