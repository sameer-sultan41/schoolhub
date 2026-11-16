"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@schoolhub/ui";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";

import { ImageFileField } from "./image-file-field";
import { textValue } from "./schema-model";
import { HEADING_LEVELS, RICH_TEXT_LIMITS, type RichTextBlockType } from "./rich-text";

export interface RichTextBlockProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** The block's path, e.g. `body.blocks.2`. */
  name: string;
  /** The sortable id (the field array's own key, never sent). */
  id: string;
  type: RichTextBlockType;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

/** A text input of the block, with its own `FormMessage` so a server error lands under it. */
function BlockTextField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  max,
  multiline,
}: {
  form: UseFormReturn<TFieldValues>;
  name: string;
  label: string;
  max: number;
  multiline: boolean;
}) {
  return (
    <FormField
      control={form.control}
      name={name as Path<TFieldValues>}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea {...field} value={textValue(field.value)} rows={3} />
            ) : (
              <Input {...field} value={textValue(field.value)} maxLength={max} />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** One block of the rich-text editor: its drag handle, move and remove buttons, and its inputs. */
export function RichTextBlock<TFieldValues extends FieldValues>({
  form,
  name,
  id,
  type,
  index,
  count,
  onMove,
  onRemove,
}: RichTextBlockProps<TFieldValues>) {
  const t = useTranslations("website.richText");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const position = index + 1;
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 2 : undefined,
  };
  const path = (key: string) => `${name}.${key}` as Path<TFieldValues>;

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={t("blockLabel", { index: position, type: t(`types.${type}`) })}
      className="space-y-3 rounded-md border border-border bg-background p-3"
    >
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          {...attributes}
          {...listeners}
          aria-label={t("dragHandle", { index: position })}
        >
          <GripVertical aria-hidden="true" />
        </Button>
        <span className="flex-1 text-sm font-medium">{t(`types.${type}`)}</span>
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          disabled={index === 0}
          aria-label={t("moveUp", { index: position })}
          onClick={() => {
            onMove(index, index - 1);
          }}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          disabled={index === count - 1}
          aria-label={t("moveDown", { index: position })}
          onClick={() => {
            onMove(index, index + 1);
          }}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          aria-label={t("remove", { index: position })}
          onClick={() => {
            onRemove(index);
          }}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      {type === "heading" ? (
        <FormField
          control={form.control}
          name={path("level")}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("level")}</FormLabel>
              <Select
                value={String(field.value)}
                onValueChange={(value) => {
                  field.onChange(Number(value));
                }}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {HEADING_LEVELS.map((level) => (
                    <SelectItem key={level} value={String(level)}>
                      {t("levelOption", { level })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {type === "paragraph" || type === "quote" || type === "heading" ? (
        <BlockTextField
          form={form}
          name={path("text")}
          label={t("text")}
          max={RICH_TEXT_LIMITS[type]}
          multiline={type !== "heading"}
        />
      ) : null}

      {type === "list" ? (
        <>
          <FormField
            control={form.control}
            name={path("ordered")}
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <FormLabel>{t("ordered")}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value === true} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={path("items")}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("items")}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    name={field.name}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    value={((field.value as string[] | undefined) ?? []).join("\n")}
                    onChange={(event) => {
                      field.onChange(event.target.value.split("\n"));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ) : null}

      {type === "image" ? (
        <>
          <ImageFileField form={form} name={path("file_id")} label={t("image")} required />
          <BlockTextField
            form={form}
            name={path("alt")}
            label={t("alt")}
            max={RICH_TEXT_LIMITS.alt}
            multiline={false}
          />
        </>
      ) : null}
    </li>
  );
}
