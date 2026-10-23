"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCampuses } from "@/hooks/use-reference-data";
import {
  ROOM_BUILDING_MAX,
  ROOM_CODE_MAX,
  ROOM_FLOOR_MAX,
  ROOM_MIN_CAPACITY,
  ROOM_NAME_MAX,
  ROOM_TYPES,
} from "@/services/modules/rooms/rooms-constant";
import type { RoomFormValues } from "@/services/modules/rooms/rooms.schema";

/** The plain text inputs, as `[name, label key, max length]`: same shape, one render. */
const TEXT_FIELDS = [
  ["name", "fields.name", ROOM_NAME_MAX],
  ["building", "fields.building", ROOM_BUILDING_MAX],
  ["floor", "fields.floor", ROOM_FLOOR_MAX],
] as const;

/** The room form's inputs. Every field renders its own `FormMessage`, so a server error the
 * dialog maps onto it is shown under it. */
export function RoomFormFields({ form }: { form: UseFormReturn<RoomFormValues> }) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const campusesQuery = useCampuses();
  const typeOptions = ROOM_TYPES.map((roomType) => ({
    id: roomType,
    name: t(`rooms.types.${roomType}`),
  }));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="campus_id"
          label={t("fields.campus")}
          placeholder={campusesQuery.isPending ? tCommon("loading") : t("fields.selectCampus")}
          options={campusesQuery.data ?? []}
        />
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.code")}</FormLabel>
              <FormControl>
                <Input maxLength={ROOM_CODE_MAX} {...field} />
              </FormControl>
              <FormDescription>{t("rooms.form.codeHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormSelectField
          form={form}
          name="room_type"
          label={t("fields.roomType")}
          placeholder={t("fields.roomType")}
          options={typeOptions}
        />
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.capacity")}</FormLabel>
              <FormControl>
                <Input type="number" inputMode="numeric" min={ROOM_MIN_CAPACITY} {...field} />
              </FormControl>
              <FormDescription>{t("rooms.form.capacityBlankHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {TEXT_FIELDS.map(([name, labelKey, maxLength]) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(labelKey)}</FormLabel>
                <FormControl>
                  <Input maxLength={maxLength} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      <FormField
        control={form.control}
        name="is_active"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("fields.isActive")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormDescription>{t("rooms.form.isActiveHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
