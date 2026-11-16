"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Images } from "lucide-react";

import { ContentDirectoryCard } from "@/features/website/shared/content-directory-card";
import { useContentDirectory } from "@/features/website/shared/use-content-directory";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type GalleryAlbumRecord } from "@/services";
import {
  ALBUM_SORT_FIELD,
  ALBUM_STATUSES,
  GALLERY_ALBUMS_RESOURCE,
} from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { useAlbumColumns } from "./album-columns";
import { AlbumFormDialog } from "./album-form-dialog";

/**
 * The `/website/gallery` directory: every album, searched and filtered by status, server
 * paginated, with the view state in the URL. A title opens the album's page; Edit is the row's
 * own, mounted only while open.
 */
export function AlbumDirectory() {
  const t = useTranslations("website.gallery");
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "website.gallery-album.update");
  const canPublish = hasPermission(user, "website.gallery-album.publish");
  const [editTarget, setEditTarget] = useState<GalleryAlbumRecord | null>(null);

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((album: GalleryAlbumRecord) => {
    setEditTarget(album);
  }, []);
  const columns = useAlbumColumns({ canUpdate, canPublish, onEdit: handleEdit });
  const directory = useContentDirectory({
    columns,
    resource: GALLERY_ALBUMS_RESOURCE,
    sortField: ALBUM_SORT_FIELD,
    fetchPage: Services.galleryAlbums.fetchGalleryAlbumPage,
    statuses: ALBUM_STATUSES,
  });

  return (
    <ContentDirectoryCard
      directory={directory}
      icon={Images}
      labels={{
        caption: t("list.caption"),
        searchPlaceholder: t("list.searchPlaceholder"),
        loadError: t("list.loadError"),
        emptyTitle: t("list.emptyTitle"),
        emptyDescription: t("list.emptyDescription"),
      }}
    >
      {editTarget && (
        <AlbumFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          album={editTarget}
        />
      )}
    </ContentDirectoryCard>
  );
}
