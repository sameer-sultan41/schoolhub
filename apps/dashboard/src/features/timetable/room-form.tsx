"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormDescription,
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
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/components/api-error-alert";
import { mapRoomFieldErrors } from "@/features/timetable/room-map-field-errors";
import { roomSchema, type RoomFormValues } from "@/features/timetable/room-schema";
import { ROOM_TYPES } from "@/features/timetable/timetable-constants";
import type { RoomRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

function valuesFor(room: RoomRecord | undefined): RoomFormValues {
  return {
    campus_id: room?.campus_id ?? "",
    name: room?.name ?? "",
    code: room?.code ?? "",
    room_type: room?.room_type ?? "classroom",
    capacity: room?.capacity != null ? String(room.capacity) : "",
    building: room?.building ?? "",
    floor: room?.floor ?? "",
    is_active: room?.is_active ?? true,
  };
}

interface RoomFormProps {
  /** Omit to create. */
  room?: RoomRecord;
}

/** A physical room (§5.4) — type and capacity are what the conflict engine reads
 * when it warns that a section will not fit. */
export function RoomForm({ room }: RoomFormProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const campuses = useCampusOptions();

  const form = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchema),
    defaultValues: valuesFor(room),
  });
  const { handleSubmit, setError, reset, control } = form;

  // useWatch, never form.watch(): only the capacity hint depends on this, and
  // watch() would re-render every field on every keystroke anywhere in the form.
  const capacity = useWatch({ control, name: "capacity" });

  const mutation = useMutation({
    mutationFn: (values: RoomFormValues) => {
      const payload = {
        campus_id: values.campus_id,
        name: values.name,
        code: values.code,
        room_type: values.room_type,
        // Empty string → null here rather than in the schema: an unrecorded
        // capacity is what makes `_room_over_capacity` skip the room entirely,
        // which is a different thing from a capacity of zero.
        capacity: values.capacity ? Number(values.capacity) : null,
        building: values.building || null,
        floor: values.floor || null,
        is_active: values.is_active,
      };
      return room
        ? apiClient.patch<RoomRecord>(`/rooms/${room.id}`, payload)
        : apiClient.post<RoomRecord>("/rooms", payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      reset(valuesFor(room));
      setOpen(false);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapRoomFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof RoomFormValues, { type: "server", message: issue });
      }
      if (unknown.length > 0) {
        setError("root", { type: "server", message: unknown.join(" ") });
      }
    },
  });

  const rootMessage = form.formState.errors.root?.message;
  const envelopeError = unhandledEnvelopeError(mutation.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(valuesFor(room));
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={room ? "outline" : "primary"}>
          {room ? t("rooms.actions.edit") : t("rooms.actions.create")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {room ? t("rooms.form.editTitle") : t("rooms.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("rooms.form.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={envelopeError} />
        {rootMessage ? (
          <p role="alert" className="text-sm text-danger">
            {rootMessage}
          </p>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while saving the room:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={control}
              name="campus_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.campus")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.campus")}>
                        <SelectValue placeholder={t("fields.selectCampus")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(campuses.data ?? []).map((campus) => (
                        <SelectItem key={campus.id} value={campus.id}>
                          {campus.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.name")}</FormLabel>
                    <FormControl required>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.code")}</FormLabel>
                    <FormControl required>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>{t("rooms.form.codeHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={control}
                name="room_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.roomType")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl required>
                        <SelectTrigger aria-label={t("fields.roomType")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ROOM_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`rooms.types.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.capacity")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={1} inputMode="numeric" />
                    </FormControl>
                    <FormDescription>
                      {capacity ? t("rooms.form.capacityHint") : t("rooms.form.capacityBlankHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={control}
                name="building"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.building")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="floor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.floor")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={control}
              name="is_active"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <input
                        type="checkbox"
                        name={field.name}
                        ref={field.ref}
                        checked={field.value}
                        onBlur={field.onBlur}
                        onChange={(event) => {
                          field.onChange(event.target.checked);
                        }}
                        className="size-4 rounded-[var(--sh-radius)] border border-border accent-[var(--sh-color-primary)]"
                      />
                    </FormControl>
                    <FormLabel>{t("fields.isActive")}</FormLabel>
                  </div>
                  <FormDescription>{t("rooms.form.isActiveHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={tCommon("loading")}
              >
                {tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
