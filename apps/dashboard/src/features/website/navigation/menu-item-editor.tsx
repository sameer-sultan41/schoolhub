"use client";

import type { ReactNode } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { Button } from "@schoolhub/ui";
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  CornerUpLeft,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";

import type { WebsitePageRecord } from "@/services";
import { NAV_PAGE_TARGET } from "@/services/modules/website/navigation-menus/navigation-menus-constant";
import { textValue } from "@/features/website/shared/schema-model";
import { MenuLinkFields } from "./menu-link-fields";
import type { MenuFormValues } from "./navigation-model";
import { useMenuDnd, useSortableRow } from "./use-menu-dnd";

/** An icon button of a row: the icon is decorative, the label says what it does to which link. */
function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      mode="icon"
      size="sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export interface MenuItemEditorProps {
  form: UseFormReturn<MenuFormValues>;
  /** The sortable id (the field array's own key, never sent). */
  id: string;
  index: number;
  count: number;
  pages: readonly WebsitePageRecord[];
  /** Whether this link may move under the one above (`canNest`): not the first, no sub-links. */
  nestable: boolean;
  /** The menu holds `NAV_MAX_ITEMS` links: nothing more can be added. */
  full: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onNest: (index: number) => void;
  onUnnest: (index: number, childIndex: number) => void;
}

/**
 * One top-level link of a menu, and its sub-links: drag or move buttons to reorder, "nest under
 * the link above" and "move out" between the two levels, add a sub-link, and remove. A sub-link
 * has no sub-links of its own, and a link holding sub-links can't be nested (menus nest two
 * levels deep); the disabled button says why.
 */
export function MenuItemEditor({
  form,
  id,
  index,
  count,
  pages,
  nestable,
  full,
  onMove,
  onRemove,
  onNest,
  onUnnest,
}: MenuItemEditorProps) {
  const t = useTranslations("website.navigation");
  const { setNodeRef, style, handleProps } = useSortableRow(id);
  const children = useFieldArray({ control: form.control, name: `items.${index}.children` });
  const childIds = children.fields.map((field) => field.id);
  const childDnd = useMenuDnd(childIds, children.move);
  const label = useWatch({ control: form.control, name: `items.${index}.label` });
  const position = index + 1;
  // Read through `textValue`: a row being removed can render once more after its value is gone.
  const name = textValue(label).trim() || t("untitled");
  const hasChildren = children.fields.length > 0;

  return (
    <li
      ref={setNodeRef}
      style={style}
      tabIndex={-1}
      data-row-path={`items.${String(index)}`}
      aria-label={t("item.label", { index: position, name })}
      className="space-y-3 rounded-md border border-border bg-background p-3 outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          mode="icon"
          size="sm"
          {...handleProps}
          aria-label={t("item.drag", { index: position })}
        >
          <GripVertical aria-hidden="true" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <RowButton
          label={t("item.moveUp", { index: position })}
          disabled={index === 0}
          onClick={() => {
            onMove(index, index - 1);
          }}
        >
          <ArrowUp aria-hidden="true" />
        </RowButton>
        <RowButton
          label={t("item.moveDown", { index: position })}
          disabled={index === count - 1}
          onClick={() => {
            onMove(index, index + 1);
          }}
        >
          <ArrowDown aria-hidden="true" />
        </RowButton>
        <RowButton
          label={
            hasChildren
              ? t("item.nestBlocked", { index: position })
              : t("item.nest", { index: position })
          }
          disabled={!nestable}
          onClick={() => {
            onNest(index);
          }}
        >
          <CornerDownRight aria-hidden="true" className="rtl:-scale-x-100" />
        </RowButton>
        <RowButton
          label={t("item.remove", { index: position })}
          onClick={() => {
            onRemove(index);
          }}
        >
          <Trash2 aria-hidden="true" />
        </RowButton>
      </div>
      <MenuLinkFields form={form} name={`items.${index}`} pages={pages} />
      {hasChildren ? (
        <DndContext
          sensors={childDnd.sensors}
          collisionDetection={closestCenter}
          accessibility={childDnd.accessibility}
          onDragEnd={childDnd.onDragEnd}
        >
          <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
            <ol
              className="space-y-3 border-s-2 border-border ps-4"
              aria-label={t("item.children", { name })}
            >
              {children.fields.map((field, childIndex) => (
                <MenuChildRow
                  key={field.id}
                  form={form}
                  id={field.id}
                  parentIndex={index}
                  index={childIndex}
                  count={children.fields.length}
                  pages={pages}
                  onMove={children.move}
                  onRemove={children.remove}
                  onUnnest={() => {
                    onUnnest(index, childIndex);
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={full}
        onClick={() => {
          children.append({ label: "", target_type: NAV_PAGE_TARGET, target: "" });
        }}
      >
        <Plus aria-hidden="true" />
        {t("item.addChild", { name })}
      </Button>
    </li>
  );
}

interface MenuChildRowProps {
  form: UseFormReturn<MenuFormValues>;
  id: string;
  parentIndex: number;
  index: number;
  count: number;
  pages: readonly WebsitePageRecord[];
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onUnnest: () => void;
}

/** A sub-link: reorder within its parent, move out to the top level, or remove. */
function MenuChildRow({
  form,
  id,
  parentIndex,
  index,
  count,
  pages,
  onMove,
  onRemove,
  onUnnest,
}: MenuChildRowProps) {
  const t = useTranslations("website.navigation");
  const { setNodeRef, style, handleProps } = useSortableRow(id);
  const parent = parentIndex + 1;
  const position = index + 1;
  const where = { parent, index: position };

  return (
    <li
      ref={setNodeRef}
      style={style}
      tabIndex={-1}
      data-row-path={`items.${String(parentIndex)}.children.${String(index)}`}
      aria-label={t("child.label", where)}
      className="space-y-3 rounded-md border border-border bg-background p-3 outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          mode="icon"
          size="sm"
          {...handleProps}
          aria-label={t("child.drag", where)}
        >
          <GripVertical aria-hidden="true" />
        </Button>
        <span className="flex-1 text-sm text-muted-foreground">{t("child.title", where)}</span>
        <RowButton
          label={t("child.moveUp", where)}
          disabled={index === 0}
          onClick={() => {
            onMove(index, index - 1);
          }}
        >
          <ArrowUp aria-hidden="true" />
        </RowButton>
        <RowButton
          label={t("child.moveDown", where)}
          disabled={index === count - 1}
          onClick={() => {
            onMove(index, index + 1);
          }}
        >
          <ArrowDown aria-hidden="true" />
        </RowButton>
        <RowButton label={t("child.unnest", where)} onClick={onUnnest}>
          <CornerUpLeft aria-hidden="true" className="rtl:-scale-x-100" />
        </RowButton>
        <RowButton
          label={t("child.remove", where)}
          onClick={() => {
            onRemove(index);
          }}
        >
          <Trash2 aria-hidden="true" />
        </RowButton>
      </div>
      <MenuLinkFields form={form} name={`items.${parentIndex}.children.${index}`} pages={pages} />
    </li>
  );
}
