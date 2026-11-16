"use client";

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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import {
  useFieldArray,
  useWatch,
  type ArrayPath,
  type FieldArray,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import { Button, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { RichTextBlock as BlockEditor } from "./rich-text-block";
import { newBlock, RICH_TEXT_BLOCK_TYPES, type RichTextBlock } from "./rich-text";

/** A pointer drag starts only past this many pixels, so a click on the handle stays a click. */
const DRAG_ACTIVATION_DISTANCE = 4;

export interface RichTextBlocksFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** The document's path; its value is `{ blocks: [...] }` (`{ blocks: [] }` when empty). */
  name: Path<TFieldValues>;
  label: string;
}

/**
 * The rich-text editor (decision 5): an ordered list of typed blocks (paragraph, heading,
 * list, quote, image), added from a row of buttons, reordered by drag (pointer or keyboard)
 * or the move buttons, and removed. Every block input is a form field of its own, so a server
 * error keyed `body.blocks.2.text` lands under that input. Nothing is ever rendered as HTML.
 */
export function RichTextBlocksField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
}: RichTextBlocksFieldProps<TFieldValues>) {
  const t = useTranslations("website.richText");
  const blocksPath = `${name}.blocks` as ArrayPath<TFieldValues>;
  const { fields, append, move, remove } = useFieldArray({
    control: form.control,
    name: blocksPath,
  });
  const blocks = (useWatch({ control: form.control, name: blocksPath as Path<TFieldValues> }) ??
    []) as RichTextBlock[];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = fields.map((field) => field.id);
  const positionOf = (id: string | number) => ids.indexOf(String(id)) + 1;

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

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) move(from, to);
  }

  return (
    <FormField
      control={form.control}
      name={name}
      render={() => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <div role="group" aria-label={label} className="space-y-3">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                accessibility={{
                  announcements,
                  screenReaderInstructions: { draggable: t("dragInstructions") },
                }}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("empty")}</p>
                  ) : (
                    <ol className="space-y-3">
                      {fields.map((field, index) => (
                        <BlockEditor
                          key={field.id}
                          form={form}
                          name={`${blocksPath}.${index}`}
                          id={field.id}
                          type={blocks[index]?.type ?? "paragraph"}
                          index={index}
                          count={fields.length}
                          onMove={move}
                          onRemove={remove}
                        />
                      ))}
                    </ol>
                  )}
                </SortableContext>
              </DndContext>
            </div>
          </FormControl>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("add")}>
            {RICH_TEXT_BLOCK_TYPES.map((type) => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                onClick={() => {
                  append(newBlock(type) as FieldArray<TFieldValues, ArrayPath<TFieldValues>>);
                }}
              >
                <Plus aria-hidden="true" />
                {t("addBlock", { type: t(`types.${type}`) })}
              </Button>
            ))}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
