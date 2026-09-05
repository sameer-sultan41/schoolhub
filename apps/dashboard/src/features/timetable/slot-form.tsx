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
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Can } from "@/components/can";
import { mapSlotFieldErrors } from "@/features/timetable/slot-map-field-errors";
import { slotSchema, type SlotFormValues } from "@/features/timetable/slot-schema";
import { NONE } from "@/features/timetable/timetable-constants";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/features/timetable/timetable-error-alert";
import {
  readConflicts,
  type TimetableConflict,
  type TimetableSlotRecord,
} from "@/features/timetable/timetable-types";
import {
  useRoomOptions,
  useSubjectOptions,
  useTeachingStaffOptions,
} from "@/features/timetable/use-timetable-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface SlotEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academicSessionId: string;
  sectionId: string;
  dayOfWeek: number;
  periodId: string;
  /** The cell's current occupant, or undefined when the cell is empty. */
  slot?: TimetableSlotRecord;
  /** Human-readable "Monday · Period 2", for the dialog's own description. */
  cellLabel: string;
  /** Every write answers with `meta.conflicts` (§16); the grid renders them
   * against the offending cells, so they are handed back rather than shown here. */
  onConflicts: (conflicts: TimetableConflict[]) => void;
}

function valuesFor(slot: TimetableSlotRecord | undefined): SlotFormValues {
  return {
    subject_id: slot?.subject_id ?? NONE,
    staff_id: slot?.staff_id ?? NONE,
    room_id: slot?.room_id ?? NONE,
    notes: slot?.notes ?? "",
  };
}

/**
 * One cell of the week grid, opened by clicking it (§5.2).
 *
 * Creates a draft slot when the cell is empty and patches it when it is not.
 * There is no optimistic update: a write's real value is the `meta.conflicts` it
 * comes back with, and a cell painted before the server answered would show a
 * clash-free grid that the very next response contradicts. The mutation
 * invalidates `queryKeys.module("timetable")` on success instead.
 *
 * Published cells are not editable here at all —
 * `services.assert_slot_writable` answers 409 for those, because editing a live
 * cell would change what students already read without the validation and
 * notification a publish carries (§5.7). The grid does not open this dialog for
 * one; if it somehow did, the 409 renders through the envelope alert.
 */
export function SlotEditorDialog({
  open,
  onOpenChange,
  academicSessionId,
  sectionId,
  dayOfWeek,
  periodId,
  slot,
  cellLabel,
  onConflicts,
}: SlotEditorDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const subjects = useSubjectOptions();
  const staff = useTeachingStaffOptions();
  const rooms = useRoomOptions();

  const form = useForm<SlotFormValues>({
    resolver: zodResolver(slotSchema),
    defaultValues: valuesFor(slot),
  });
  const { handleSubmit, setError, reset, control } = form;

  // The dialog is mounted once by the grid and re-pointed at whichever cell was
  // clicked, so the defaults have to follow the cell rather than the mount.
  useEffect(() => {
    if (open) reset(valuesFor(slot));
  }, [open, slot, reset]);

  // useWatch, never form.watch(): watch() re-renders the whole form on every
  // keystroke in the notes box, and this only needs the two Selects.
  const subjectId = useWatch({ control, name: "subject_id" });
  const staffId = useWatch({ control, name: "staff_id" });
  // conflicts._unallocated_teachers only fires when BOTH are set — a homeroom
  // slot with a teacher and no subject needs no allocation.
  const needsAllocation = subjectId !== NONE && staffId !== NONE;

  const save = useMutation({
    mutationFn: (values: SlotFormValues) => {
      // Empty sentinel → null here rather than in the schema: "no subject" is a
      // real, saved state (a homeroom slot), and the column is nullable.
      const payload = {
        academic_session_id: academicSessionId,
        section_id: sectionId,
        day_of_week: dayOfWeek,
        period_id: periodId,
        subject_id: values.subject_id === NONE ? null : values.subject_id,
        staff_id: values.staff_id === NONE ? null : values.staff_id,
        room_id: values.room_id === NONE ? null : values.room_id,
        notes: values.notes || null,
      };
      return slot
        ? apiClient.patch<TimetableSlotRecord>(`/timetable-slots/${slot.id}`, payload)
        : apiClient.post<TimetableSlotRecord>("/timetable-slots", payload);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      onConflicts(readConflicts(result.meta));
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapSlotFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof SlotFormValues, { type: "server", message: issue });
      }
      if (unknown.length > 0) {
        setError("root", { type: "server", message: unknown.join(" ") });
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => apiClient.delete(`/timetable-slots/${slot?.id ?? ""}`),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      // A deletion can *resolve* conflicts as easily as leave them, and the
      // response says which — so the grid is told either way.
      onConflicts(readConflicts(result.meta));
      onOpenChange(false);
    },
  });

  const rootMessage = form.formState.errors.root?.message;
  const envelopeError = unhandledEnvelopeError(save.error) ?? remove.error;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset(valuesFor(slot));
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{slot ? t("slot.form.editTitle") : t("slot.form.createTitle")}</DialogTitle>
          <DialogDescription>{cellLabel}</DialogDescription>
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
                save.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while saving the timetable slot:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={control}
              name="subject_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.subject")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label={t("fields.subject")}>
                        <SelectValue placeholder={t("fields.selectSubject")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("fields.none")}</SelectItem>
                      {(subjects.data ?? []).map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("slot.form.subjectHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="staff_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.teacher")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label={t("fields.teacher")}>
                        <SelectValue placeholder={t("fields.selectTeacher")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("fields.none")}</SelectItem>
                      {(staff.data ?? []).map((teacher) => (
                        <SelectItem key={teacher.id} value={teacher.id}>
                          {`${teacher.first_name} ${teacher.last_name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {needsAllocation ? (
                    <FormDescription>{t("slot.form.allocationHint")}</FormDescription>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="room_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.room")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label={t("fields.room")}>
                        <SelectValue placeholder={t("fields.selectRoom")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("fields.none")}</SelectItem>
                      {(rooms.data ?? []).map((room) => (
                        <SelectItem key={room.id} value={room.id}>
                          {`${room.code} — ${room.name}`}
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.notes")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>{t("slot.form.notesHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              {slot ? (
                <Can permission="timetable.slot.delete">
                  <Button
                    type="button"
                    variant="danger"
                    isLoading={remove.isPending}
                    loadingLabel={tCommon("loading")}
                    onClick={() => {
                      remove.mutate();
                    }}
                  >
                    {t("slot.actions.clear")}
                  </Button>
                </Can>
              ) : null}
              <Can permission={slot ? "timetable.slot.update" : "timetable.slot.create"}>
                <Button type="submit" isLoading={save.isPending} loadingLabel={tCommon("loading")}>
                  {tCommon("save")}
                </Button>
              </Can>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
