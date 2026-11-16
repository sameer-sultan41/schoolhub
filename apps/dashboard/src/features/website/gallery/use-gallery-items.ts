"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useContentErrors } from "@/features/website/shared/content-errors";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services, type GalleryItemRecord } from "@/services";
import { GALLERY_ITEMS_RESOURCE } from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

/** The query key of one album's items, under the `website` module every write invalidates. */
export function galleryItemsKey(albumId: string) {
  return queryKeys.list(WEBSITE_QUERY_MODULE, GALLERY_ITEMS_RESOURCE, { albumId });
}

/** `ids` taken in their new order from `items`; an id the list no longer holds is skipped. */
export function inOrder(items: readonly GalleryItemRecord[], ids: readonly string[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

/** `ids` with the one at `from` moved to `to`. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/**
 * An album's items, in display order, and their reorder. A reorder shows at once and sends
 * every id in the new order (`PATCH …/gallery-items:reorder`, the server's own check that the
 * list is the album's whole set); the server's answer replaces the list, and a refusal puts
 * the previous order back and says why.
 */
export function useGalleryItems(albumId: string) {
  const tGallery = useTranslations("website.gallery.items");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { localise } = useContentErrors();
  const queryKey = galleryItemsKey(albumId);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const query = useQuery({
    queryKey,
    queryFn: () => Services.galleryAlbums.fetchGalleryItems(albumId),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => Services.galleryAlbums.reorderGalleryItems(albumId, ids),
    onMutate: async (ids) => {
      setReorderError(null);
      setAnnouncement("");
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<GalleryItemRecord[]>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, inOrder(previous, ids));
      return { previous };
    },
    onSuccess: (items) => {
      queryClient.setQueryData(queryKey, items);
      setAnnouncement(tGallery("reordered"));
    },
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setReorderError(
        resolveErrorMessage(
          foldUnknownFieldErrors(localise(error)),
          tErrors,
          tCommon("submitFailed"),
          NON_FIELD,
        ),
      );
    },
  });

  return {
    query,
    items: query.data ?? [],
    reorder: (ids: string[]) => {
      reorder.mutate(ids);
    },
    isReordering: reorder.isPending,
    reorderError,
    announcement,
  };
}
