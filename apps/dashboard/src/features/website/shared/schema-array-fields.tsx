"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  useFieldArray,
  useWatch,
  type ArrayPath,
  type FieldArray,
  type FieldValues,
  type Path,
  type PathValue,
  type UseFormReturn,
} from "react-hook-form";
import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { textValue } from "./schema-model";

interface ArrayFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  name: string;
  label: string;
}

/** Up, down and remove for item `index` (1-based in the labels). */
function ItemButtons({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("website.schemaFields");
  const position = index + 1;
  return (
    <div className="flex items-center gap-1">
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
        aria-label={t("removeItem", { index: position })}
        onClick={() => {
          onRemove(index);
        }}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

/** A list of objects (an FAQ's questions): each item a group of fields, added, moved and
 * removed. The list itself keeps a `FormMessage` for an error about the whole list. */
export function SchemaObjectArrayField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  newItem,
  renderItem,
}: ArrayFieldProps<TFieldValues> & {
  newItem: () => Record<string, unknown>;
  renderItem: (itemName: string) => ReactNode;
}) {
  const t = useTranslations("website.schemaFields");
  const path = name as ArrayPath<TFieldValues>;
  const { fields, append, move, remove } = useFieldArray({ control: form.control, name: path });

  return (
    <FormField
      control={form.control}
      name={name as Path<TFieldValues>}
      render={() => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <ol className="space-y-3">
            {fields.map((field, index) => (
              <li key={field.id}>
                <fieldset className="space-y-3 rounded-md border border-border p-3">
                  <legend className="px-1 text-sm font-medium">
                    {t("itemHeading", { index: index + 1 })}
                  </legend>
                  <div className="flex justify-end">
                    <ItemButtons
                      index={index}
                      count={fields.length}
                      onMove={move}
                      onRemove={remove}
                    />
                  </div>
                  {renderItem(`${name}.${index}`)}
                </fieldset>
              </li>
            ))}
          </ol>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                append(newItem() as FieldArray<TFieldValues, ArrayPath<TFieldValues>>);
              }}
            >
              <Plus aria-hidden="true" />
              {t("addItem")}
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** A list of strings: one input per item, each with its own `FormMessage`. */
export function SchemaStringArrayField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
}: ArrayFieldProps<TFieldValues>) {
  const t = useTranslations("website.schemaFields");
  const path = name as Path<TFieldValues>;
  const items = (useWatch({ control: form.control, name: path }) ?? []) as string[];
  const write = (next: string[]) => {
    form.setValue(path, next as PathValue<TFieldValues, Path<TFieldValues>>, { shouldDirty: true });
  };
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    write(next);
  };

  return (
    <FormField
      control={form.control}
      name={path}
      render={() => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <ol className="space-y-2">
            {items.map((_, index) => (
              <li key={index} className="flex items-start gap-2">
                <FormField
                  control={form.control}
                  name={`${name}.${index}` as Path<TFieldValues>}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input
                          {...field}
                          aria-label={t("itemHeading", { index: index + 1 })}
                          value={textValue(field.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ItemButtons
                  index={index}
                  count={items.length}
                  onMove={move}
                  onRemove={(at) => {
                    write(items.filter((__, other) => other !== at));
                  }}
                />
              </li>
            ))}
          </ol>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                write([...items, ""]);
              }}
            >
              <Plus aria-hidden="true" />
              {t("addItem")}
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
