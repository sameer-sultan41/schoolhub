"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery, type QueryKey } from "@tanstack/react-query";
import { isCursorPagination, type Page } from "@schoolhub/types";

import { useCursorStack } from "@/features/attendance/use-cursor-stack";

export interface CursorListOptions<TItem> {
  /** The query the cursors belong to (its filters and sort): a change starts over at page one. */
  resetKey: string;
  /** The cache key of one page; `cursor` is `undefined` for the first page. */
  queryKey: (cursor: string | undefined) => QueryKey;
  queryFn: (cursor: string | undefined) => Promise<Page<TItem>>;
}

/**
 * One cursor-paginated list read: the page at the current cursor, kept on screen while the next
 * one loads (`keepPreviousData`), its rows, the next page's cursor, and the stack of pages moved
 * past for Previous. `retry` starts over from page one when a later page failed, since a cursor
 * the server no longer accepts would fail again; on page one it simply refetches.
 */
export function useCursorList<TItem>({ resetKey, queryKey, queryFn }: CursorListOptions<TItem>) {
  const stack = useCursorStack(resetKey);
  const { cursor } = stack;

  const query = useQuery({
    queryKey: queryKey(cursor),
    queryFn: () => queryFn(cursor),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);
  const pageMeta = query.data?.pagination;
  const nextCursor = pageMeta && isCursorPagination(pageMeta) ? pageMeta.next_cursor : null;

  function retry() {
    if (stack.hasPrevious) stack.reset();
    else void query.refetch();
  }

  return { query, rows, cursor, stack, nextCursor, retry };
}

export type CursorList<TItem> = ReturnType<typeof useCursorList<TItem>>;
