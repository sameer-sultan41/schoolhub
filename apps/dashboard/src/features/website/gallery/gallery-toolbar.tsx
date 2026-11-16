"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { galleryAlbumPath } from "@/config/paths";
import { ContentToolbar } from "@/features/website/shared/content-toolbar";
import { AlbumFormDialog } from "./album-form-dialog";

/** The Gallery heading and "New album" (`website.gallery-album.create`); a new album opens on
 * its own page, where its photos and videos are added. */
export function GalleryToolbar() {
  const t = useTranslations("website.gallery");
  const router = useRouter();
  return (
    <ContentToolbar
      title={t("title")}
      description={t("summary")}
      createLabel={t("actions.create")}
      createPermission="website.gallery-album.create"
      renderCreateDialog={(onOpenChange) => (
        <AlbumFormDialog
          open
          onOpenChange={onOpenChange}
          onCreated={(album) => {
            router.push(galleryAlbumPath(album.id));
          }}
        />
      )}
    />
  );
}
