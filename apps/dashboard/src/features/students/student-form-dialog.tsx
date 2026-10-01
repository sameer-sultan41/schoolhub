"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Form,
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
} from "@schoolhub/ui";
import { GENDER_VALUES } from "@schoolhub/types";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  buildStudentInput,
  detailToFormValues,
  EMPTY_DEFAULTS,
  studentFormSchema,
  UNSET_VALUE,
  type StudentFormValues,
} from "./student-form-schema";
import { StudentAddressFields } from "./student-address-fields";
import { StudentPhotoField } from "./student-photo-field";
import { StudentProfileTextFields } from "./student-profile-text-fields";

export interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  studentId?: string;
}

export function StudentFormDialog({ open, onOpenChange, mode, studentId }: StudentFormDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const isMobile = !useIsDesktopShell();
  const { data: currentUser } = useCurrentUser();

  // An "open session" counter, not a boolean: a boolean can't distinguish "still this
  // same open session" from "closed and reopened before the upload settled" — Review
  // Focus #5. Every open (including a reopen) bumps this; `captureUploadSession` (below)
  // snapshots the session number *and* studentId as an upload starts, and its returned
  // check compares both when that upload settles. Both refs are written only inside this
  // effect, never during render — writing a ref during render trips the `react-hooks/refs`
  // lint rule (round-3 review finding: an earlier draft wrote `studentIdRef.current =
  // studentId` directly in the function body).
  const sessionRef = useRef(0);
  const openSessionRef = useRef(0);
  const studentIdRef = useRef(studentId);
  useEffect(() => {
    studentIdRef.current = studentId;
    if (open) {
      sessionRef.current += 1;
      openSessionRef.current = sessionRef.current;
    } else {
      openSessionRef.current = 0;
    }
  }, [open, studentId]);

  const [formError, setFormError] = useState<string | null>(null);
  const [populatedStudentId, setPopulatedStudentId] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
    enabled: open,
  });
  const housesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "houses"),
    queryFn: () => Services.schoolOrganization.fetchHouses(),
    enabled: open,
  });
  const detailQuery = useQuery({
    queryKey: queryKeys.detail("students", "students", studentId ?? ""),
    queryFn: () => Services.students.fetchStudentById(studentId as string),
    enabled: mode === "edit" && open && !!studentId,
  });

  // Radix's `Select` mirrors its value into a hidden native `<select>` and, if that
  // value changes before the matching `<option>` has registered (true for every select
  // on the render right after mount), silently blanks itself — so Campus/House must not
  // mount until the reset below has already run once. Mirrors staff-form-dialog.tsx's
  // identical `isDetailLoading` gate exactly, for the identical reason.
  const isDetailLoading =
    mode === "edit" &&
    (detailQuery.isPending || (detailQuery.data !== undefined && populatedStudentId !== studentId));

  useEffect(() => {
    // The `populatedStudentId !== detailQuery.data.id` guard matters beyond the
    // obvious "don't redo work" case: TanStack Query can hand back a NEW `data`
    // object reference for the SAME student on a background refetch (e.g. the
    // photo's presigned URL rotating) with no edit in flight. Without this guard,
    // that refetch would silently `form.reset()` over whatever the user is
    // currently typing, discarding unsaved edits.
    if (open && mode === "edit" && detailQuery.data && populatedStudentId !== detailQuery.data.id) {
      form.reset(detailToFormValues(detailQuery.data));
      // Syncs "which record's data has actually been applied" from the query result —
      // `isDetailLoading` depends on it to keep every `Select` unmounted until this has
      // run once (see `isDetailLoading`'s own comment on why).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopulatedStudentId(detailQuery.data.id);
    }
  }, [open, mode, detailQuery.data, populatedStudentId, form]);

  useEffect(() => {
    if (!open) {
      form.reset(EMPTY_DEFAULTS);
      // Clears this dialog's own session state the moment it closes, so a reopen (edit
      // A, close, then create, or edit A then edit B) never sees a left-over field error
      // or "already populated" flag from the previous session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormError(null);
      setPopulatedStudentId(null);
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: StudentFormValues) =>
      mode === "create"
        ? Services.students.createStudent(buildStudentInput(values, "create"))
        : Services.students.updateStudent(studentId as string, buildStudentInput(values, "edit")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      onOpenChange(false);
      toast.success(mode === "create" ? t("form.createdToast") : t("form.updatedToast"));
    },
    onError: (error) => {
      setFormError(null);
      // A field error from a PREVIOUS failed submit must not survive into this one — a
      // resubmit that now fails on a different field (or with a non-field error) would
      // otherwise still show the stale field's old message alongside/instead of the
      // real one.
      form.clearErrors();
      if (error instanceof ApiError) {
        let matchedAField = false;
        for (const [field, issue] of Object.entries(error.fieldErrors())) {
          if (field !== "non_field" && field in studentFormSchema.shape) {
            form.setError(field as keyof StudentFormValues, { type: "server", message: issue });
            matchedAField = true;
          }
        }
        if (!matchedAField)
          setFormError(resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field"));
      } else {
        setFormError(t("form.submitFailed"));
      }
    },
  });

  // `StudentPhotoField` calls this as an upload starts, and applies the returned check to
  // that upload's result — success and failure alike.
  function captureUploadSession() {
    const uploadSession = openSessionRef.current;
    const uploadedStudentId = studentIdRef.current;
    return () =>
      openSessionRef.current === uploadSession && studentIdRef.current === uploadedStudentId;
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {mode === "create" ? t("form.createTitle") : t("form.editTitle")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {isDetailLoading ? (
          <ResponsiveDialogBody>
            <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
          </ResponsiveDialogBody>
        ) : (
          <Form {...form}>
            <form
              noValidate
              onSubmit={(event) => {
                form
                  .handleSubmit((values) => {
                    mutation.mutate(values);
                  })(event)
                  .catch(console.error);
              }}
              className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
            >
              {/* Desktop bounds the body with its own max-height/scrollbar; the mobile
                  drawer instead relies on its own max-h-[85vh] plus the form's flex
                  chain above, so it must not get a second, competing max-height. */}
              <ResponsiveDialogBody
                className={
                  isMobile
                    ? "space-y-4 overflow-y-auto"
                    : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
                }
              >
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.firstName")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.lastName")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.dateOfBirth")}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.gender")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("fields.selectGender")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {GENDER_VALUES.map((g) => (
                            <SelectItem key={g} value={g}>
                              {t(`gender.${g}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="campus_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.campus")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                campusesQuery.isPending
                                  ? tCommon("loading")
                                  : t("fields.selectCampus")
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(campusesQuery.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="house_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.house")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                housesQuery.isPending ? tCommon("loading") : t("fields.selectHouse")
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={UNSET_VALUE}>{t("fields.none")}</SelectItem>
                          {(housesQuery.data ?? []).map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="admission_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.admissionDate")}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <StudentPhotoField
                  form={form}
                  savedRecord={mode === "edit" ? detailQuery.data : undefined}
                  onUploadStart={captureUploadSession}
                  onUploadingChange={setIsPhotoUploading}
                />
                <StudentProfileTextFields
                  form={form}
                  showMedicalNotes={hasPermission(currentUser, "students.student.update")}
                />
                <StudentAddressFields form={form} />
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    onOpenChange(false);
                  }}
                >
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="submit"
                  isLoading={mutation.isPending}
                  loadingLabel={t("form.submitting")}
                  disabled={isPhotoUploading}
                >
                  {mode === "create" ? t("actions.create") : tCommon("save")}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          </Form>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
