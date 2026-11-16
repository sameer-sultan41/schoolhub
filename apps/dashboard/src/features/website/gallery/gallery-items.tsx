"use client";

import { useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Card, Skeleton } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { DeleteContentDialog } from "@/features/website/shared/delete-content-dialog";
import { resolveErrorMessage } from "@/lib/error-message";
import { Services, type GalleryItemRecord } from "@/services";
import { GalleryItemDialog } from "./gallery-item-dialog";
import { GalleryItemTile } from "./gallery-item-tile";
import { GalleryUpload } from "./gallery-upload";
import { moveId, useGalleryItems } from "./use-gallery-items";

/** A pointer drag starts only past this many pixels, so a click on the handle stays a click. */
const DRAG_ACTIVATION_DISTANCE = 4;

type Target =
  { action: "addVideo" } | { action: "edit" | "remove"; item: GalleryItemRecord; index: number };

/**
 * An album's photos and videos as a grid, in the order the website shows them. An editor
 * (`website.gallery-album.update`) uploads several photos at once, adds a video, edits a
 * caption or description, removes an item, and reorders by drag (pointer or keyboard) or each
 * tile's move earlier/later buttons; every reorder sends the album's whole order.
 */
export function GalleryItems({ albumId, canUpdate }: { albumId: string; canUpdate: boolean }) {
  const t = useTranslations("website.gallery.items");
  const tErrors = useTranslations("errors");
  const { query, items, reorder, isReordering, reorderError, announcement } =
    useGalleryItems(albumId);
  const [target, setTarget] = useState<Target | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((item) => item.id);
  const positionOf = (id: string | number) => ids.indexOf(String(id)) + 1;
  const moveHeld = isReordering || isUploading;

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dragStart", { index: positionOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("dragOver", { index: positionOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("dragEnd", { index: positionOf(active.id), position: positionOf(over.id) })
        : t("dragCancel"),
    onDragCancel: () => t("dragCancel"),
  };

  function move(from: number, to: number) {
    if (to < 0 || to >= ids.length || from === to) return;
    reorder(moveId(ids, from, to));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  }

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
          {canUpdate ? <p className="text-sm text-muted-foreground">{t("description")}</p> : null}
        </div>
        {canUpdate ? (
          <div className="flex flex-wrap items-start gap-2">
            <GalleryUpload albumId={albumId} onBusyChange={setIsUploading} />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTarget({ action: "addVideo" });
              }}
            >
              <Plus aria-hidden="true" />
              {t("addVideo")}
            </Button>
          </div>
        ) : null}
      </div>

      {reorderError ? (
        <Alert variant="destructive">
          <AlertDescription>{reorderError}</AlertDescription>
        </Alert>
      ) : null}
      <p className="sr-only" role="status">
        {announcement}
      </p>

      {query.isError ? (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t("dragInstructions") },
          }}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ol
              aria-label={t("caption")}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              {items.map((item, index) => (
                <GalleryItemTile
                  key={item.id}
                  item={item}
                  index={index}
                  count={items.length}
                  canUpdate={canUpdate}
                  disabled={moveHeld}
                  onMove={move}
                  onEdit={() => {
                    setTarget({ action: "edit", item, index });
                  }}
                  onRemove={() => {
                    setTarget({ action: "remove", item, index });
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {target?.action === "addVideo" && (
        <GalleryItemDialog open onOpenChange={close} albumId={albumId} />
      )}
      {target?.action === "edit" && (
        <GalleryItemDialog open onOpenChange={close} albumId={albumId} item={target.item} />
      )}
      {target?.action === "remove" && (
        <DeleteContentDialog
          open
          onOpenChange={close}
          title={t("removeTitle", { index: target.index + 1 })}
          description={t("removeDescription")}
          remove={() => Services.galleryAlbums.deleteGalleryItem(albumId, target.item.id)}
        />
      )}
    </Card>
  );
}
