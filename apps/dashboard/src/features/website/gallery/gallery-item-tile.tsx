"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { Badge, Button, cn } from "@schoolhub/ui";
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  ImageIcon,
  Pencil,
  PlayCircle,
  Trash2,
} from "lucide-react";

import type { GalleryItemRecord } from "@/services";
import { GALLERY_MEDIA_IMAGE } from "@/services/modules/website/gallery-albums/gallery-albums-constant";

export interface GalleryItemTileProps {
  item: GalleryItemRecord;
  /** Zero-based place in the album. */
  index: number;
  count: number;
  /** `website.gallery-album.update`: reorder, edit and remove. */
  canUpdate: boolean;
  /** Holds every move while the list is being reordered, uploaded to or read again. */
  disabled: boolean;
  /** Holds Edit and Remove while a reorder is in flight. */
  actionsDisabled: boolean;
  onMove: (from: number, to: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}

/** The host a video plays from, for its tile; the raw text if it is not a URL. */
function videoHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * One photo or video of an album: what it is, its caption, a warning when a photo lacks the
 * description a screen reader needs, and (for an editor) a drag handle, move earlier/later,
 * edit and remove. The CMS API carries no image URL, so a photo shows as an icon.
 */
export function GalleryItemTile({
  item,
  index,
  count,
  canUpdate,
  disabled,
  actionsDisabled,
  onMove,
  onEdit,
  onRemove,
}: GalleryItemTileProps) {
  const t = useTranslations("website.gallery.items");
  const position = index + 1;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled: !canUpdate || disabled,
  });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  const isImage = item.media_type === GALLERY_MEDIA_IMAGE;
  const MediaIcon = isImage ? ImageIcon : PlayCircle;

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={t("position", { index: position })}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex aspect-video items-center justify-center rounded-md bg-muted text-muted-foreground">
        <MediaIcon className="size-8" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">
          {isImage ? t("image") : `${t("video")} · ${videoHost(item.embed_url)}`}
        </span>
        <span className={cn("truncate", !item.caption && "text-muted-foreground")}>
          {item.caption || t("untitled")}
        </span>
        {isImage && !item.alt_text ? (
          <Badge variant="warning" appearance="light" className="self-start">
            {t("needsAlt")}
          </Badge>
        ) : null}
      </div>
      {canUpdate ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            size="sm"
            className="cursor-grab touch-none"
            disabled={disabled}
            {...attributes}
            {...listeners}
            aria-label={t("dragHandle", { index: position })}
          >
            <GripVertical aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            size="sm"
            aria-label={t("moveEarlier", { index: position })}
            disabled={disabled || index === 0}
            onClick={() => {
              onMove(index, index - 1);
            }}
          >
            <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            size="sm"
            aria-label={t("moveLater", { index: position })}
            disabled={disabled || index === count - 1}
            onClick={() => {
              onMove(index, index + 1);
            }}
          >
            <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
          </Button>
          <span className="ms-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              mode="icon"
              size="sm"
              aria-label={t("edit", { index: position })}
              disabled={actionsDisabled}
              onClick={onEdit}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              mode="icon"
              size="sm"
              aria-label={t("remove", { index: position })}
              disabled={actionsDisabled}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </span>
        </div>
      ) : null}
    </li>
  );
}
