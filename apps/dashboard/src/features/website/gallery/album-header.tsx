"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { ContentStatusBadge } from "@/features/website/shared/content-status-badge";
import { CONTENT_REASON_SCOPE } from "@/features/website/shared/content-fields";
import { DeleteContentDialog } from "@/features/website/shared/delete-content-dialog";
import { canEditContent } from "@/features/website/shared/content-permissions";
import { PublishActions } from "@/features/website/shared/publish-actions";
import { SeoButton } from "@/features/website/seo/seo-button";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type GalleryAlbumRecord } from "@/services";
import { AlbumFormDialog } from "./album-form-dialog";

/**
 * An album's title, status and actions: Edit album, Publish or Unpublish (albums have no
 * archive; the server refuses to publish an empty one, `empty_album`, and that reason shows),
 * SEO, and Delete, offered once the album is not published. Each follows its own key.
 */
export function AlbumHeader({ album }: { album: GalleryAlbumRecord }) {
  const t = useTranslations("website.gallery");
  const tContent = useTranslations("website.content");
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "website.gallery-album.update");
  const canPublish = hasPermission(user, "website.gallery-album.publish");
  const canDelete = hasPermission(user, "website.gallery-album.delete");
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="self-start" asChild>
        <Link href={Paths.WEBSITE_GALLERY}>
          <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
          {t("actions.back")}
        </Link>
      </Button>
      <Toolbar>
        <ToolbarHeading title={album.title} description={album.description || t("publishHint")} />
        <ToolbarActions>
          <ContentStatusBadge status={album.status} />
          {canEditContent(album.status, canUpdate, canPublish) && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("edit");
              }}
            >
              {t("actions.edit")}
            </Button>
          )}
          <PublishActions
            status={album.status}
            canPublish={canPublish}
            publish={() => Services.galleryAlbums.publishGalleryAlbum(album.id)}
            unpublish={() => Services.galleryAlbums.unpublishGalleryAlbum(album.id)}
          />
          <SeoButton
            target={{ targetType: "gallery_album", targetId: album.id }}
            title={album.title}
          />
          {canDelete && album.status !== "published" && (
            <Button
              variant="destructive"
              appearance="light"
              onClick={() => {
                setDialog("delete");
              }}
            >
              {tContent("delete")}
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>
      {dialog === "edit" && <AlbumFormDialog open onOpenChange={close} album={album} />}
      {dialog === "delete" && (
        <DeleteContentDialog
          open
          onOpenChange={close}
          title={t("delete.title", { title: album.title })}
          description={t("delete.description")}
          remove={() => Services.galleryAlbums.deleteGalleryAlbum(album.id)}
          reasonScope={CONTENT_REASON_SCOPE}
          onDeleted={() => {
            router.push(Paths.WEBSITE_GALLERY);
          }}
        />
      )}
    </>
  );
}
