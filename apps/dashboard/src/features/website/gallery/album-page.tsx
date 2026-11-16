"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { Images } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import { GALLERY_ALBUMS_RESOURCE } from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { AlbumHeader } from "./album-header";
import { GalleryItems } from "./gallery-items";

/**
 * One album: its header (status and actions), then its photos and videos. An album the API
 * can't find (another school's answers 404 alike) says so, with a way back.
 */
export function AlbumPage({ albumId }: { albumId: string }) {
  const t = useTranslations("website.gallery");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "website.gallery-album.update");

  const query = useQuery({
    queryKey: queryKeys.detail(WEBSITE_QUERY_MODULE, GALLERY_ALBUMS_RESOURCE, albumId),
    queryFn: () => Services.galleryAlbums.fetchGalleryAlbum(albumId),
  });
  const { data: album, error, isPending } = query;

  if (album) {
    return (
      <div className="flex flex-col gap-5">
        <AlbumHeader album={album} />
        <GalleryItems albumId={album.id} canUpdate={canUpdate} />
      </div>
    );
  }

  if (isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && error.isNotFound) {
    return (
      <EmptyState
        icon={Images}
        title={t("notFound")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.WEBSITE_GALLERY}>{t("actions.back")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <LoadErrorCard
      message={resolveErrorMessage(error, tErrors, t("loadError"))}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
