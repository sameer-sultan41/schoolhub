"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Alert,
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

import { useCurrentUser } from "@/hooks/use-current-user";
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
import { StudentTextFieldList } from "./student-text-field-list";

const NAME_FIELDS = [
  ["first_name", "firstName"],
  ["last_name", "lastName"],
] as const;

export interface StudentCreateProfileStepProps {
  mode: "create" | "edit";
  /** Required when `mode === "edit"`. */
  studentId?: string;
  /** Fires once `createStudent`/`updateStudent` succeeds. In create mode the
   * stepper advances to Guardians (or finishes) on this; in edit mode it just
   * refreshes the stepper's own copy of the student's name/campus — Back/Next
   * and the step tabs already work regardless, since the record already
   * exists. This component never navigates or closes anything itself. */
  onSaved: (student: { id: string; campusId: string; name: string }) => void;
  /** Passthrough of `StudentPhotoField`'s own upload-in-flight state, so the
   * stepper's external Next/Save button can disable itself during an upload. */
  onUploadingChange: (uploading: boolean) => void;
  /** Create mode only: true once the stepper has already created this student
   * and the user has navigated back to Profile — the form stays mounted (so
   * its entered values survive) but every field is disabled: resubmitting
   * would call `createStudent` a second time and create a duplicate student.
   * Meaningless in edit mode (resaving is the whole point there), so the
   * stepper never sets it true for an edit-mode instance. */
  locked?: boolean;
}

/**
 * The Profile step of `StudentCreateStepper` — doubles as both the wizard's
 * create flow and, since the stepper also opens for an existing student from
 * the detail sheet's Edit button, its edit flow. In edit mode it fetches and
 * prefills the existing record (the same `detailToFormValues`/`isDetailLoading`
 * gate `student-form-dialog.tsx`'s own edit mode uses) and saves via
 * `updateStudent` instead of `createStudent`; `locked`/the duplicate-create
 * guard are create-only concerns, inert in edit mode. The double-submit guard
 * (`isSubmittingRef`) applies in both modes — it is just as wrong to fire two
 * concurrent `updateStudent` calls as two `createStudent` calls.
 */
export function StudentCreateProfileStep({
  mode,
  studentId,
  onSaved,
  onUploadingChange,
  locked = false,
}: StudentCreateProfileStepProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [populatedStudentId, setPopulatedStudentId] = useState<string | null>(null);
  useEffect(() => {
    onUploadingChange(isPhotoUploading);
  }, [isPhotoUploading, onUploadingChange]);

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
  });
  const housesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "houses"),
    queryFn: () => Services.schoolOrganization.fetchHouses(),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.detail("students", "students", studentId ?? ""),
    queryFn: () => Services.students.fetchStudentById(studentId as string),
    enabled: mode === "edit" && !!studentId,
  });

  // Radix's `Select` mirrors its value into a hidden native `<select>` and, if that
  // value changes before the matching `<option>` has registered (true for every select
  // on the render right after mount), silently blanks itself — so Campus/House must not
  // mount until the reset below has already run once. Mirrors `student-form-dialog.tsx`'s
  // identical `isDetailLoading` gate exactly, for the identical reason.
  const isDetailLoading =
    mode === "edit" &&
    (detailQuery.isPending ||
      (detailQuery.data !== undefined && populatedStudentId !== detailQuery.data.id));

  useEffect(() => {
    if (mode === "edit" && detailQuery.data && populatedStudentId !== detailQuery.data.id) {
      form.reset(detailToFormValues(detailQuery.data));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopulatedStudentId(detailQuery.data.id);
    }
  }, [mode, detailQuery.data, populatedStudentId, form]);

  const mutation = useMutation({
    mutationFn: (values: StudentFormValues) =>
      mode === "create"
        ? Services.students.createStudent(buildStudentInput(values, "create"))
        : Services.students.updateStudent(studentId as string, buildStudentInput(values, "edit")),
    onSuccess: (student) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      onSaved({
        id: student.id,
        campusId: student.campus_id,
        name: `${student.first_name} ${student.last_name}`.trim(),
      });
    },
    onError: (error) => {
      setFormError(null);
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

  // `StudentPhotoField` calls this as an upload starts. No stale-identity race to guard
  // against in either mode: both the create wizard and an edit session are mounted fresh
  // per open (`StudentCreateStepper`'s own "fresh instance per open" convention — the
  // edit entry point conditionally mounts it exactly like `WithdrawStudentDialog`, never
  // reusing one instance across different students the way `student-form-dialog.tsx`
  // does), so every upload's session can't outlive its own mount.
  function captureUploadSession() {
    return () => true;
  }

  function onSubmit(event: SyntheticEvent) {
    // Belt-and-braces alongside the disabled `<fieldset>`: a locked form has no
    // real submit button rendered externally, but refuses an in-flight submit
    // here too rather than trusting that alone.
    if (locked || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    form
      .handleSubmit(
        (values) => {
          mutation.mutate(values, {
            onSettled: () => {
              isSubmittingRef.current = false;
            },
          });
        },
        () => {
          isSubmittingRef.current = false;
        },
      )(event)
      .catch((error: unknown) => {
        isSubmittingRef.current = false;
        console.error(error);
      });
  }

  if (isDetailLoading) {
    return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>;
  }

  return (
    <Form {...form}>
      <form id="student-create-profile-step" noValidate onSubmit={onSubmit}>
        {formError && (
          <Alert variant="destructive" className="mb-4">
            {formError}
          </Alert>
        )}
        {/* `display: contents` keeps every child a direct grid item of the grid
            below, so locking never changes layout — only `disabled` cascades down
            to every native input/select/button inside, the standard HTML fieldset
            behavior, with no per-field prop threading needed. */}
        <fieldset disabled={locked} className="contents">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StudentTextFieldList form={form} fields={NAME_FIELDS} namespace="fields" />
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
                            campusesQuery.isPending ? tCommon("loading") : t("fields.selectCampus")
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
            <StudentProfileTextFields
              form={form}
              showMedicalNotes={hasPermission(currentUser, "students.student.update")}
            />
            <div className="sm:col-span-2">
              <StudentPhotoField
                form={form}
                savedRecord={mode === "edit" ? detailQuery.data : undefined}
                onUploadStart={captureUploadSession}
                onUploadingChange={setIsPhotoUploading}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium text-foreground">{t("address.title")}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StudentAddressFields form={form} />
              </div>
            </div>
          </div>
        </fieldset>
        {/* No footer here — `StudentCreateStepper` renders the shared Back/Next
            footer outside this step and submits this form via its `id` attribute
            above, the same way a dialog footer button outside a `<form>` submits it
            via the HTML `form="..."` attribute. `isPhotoUploading` reaches that
            external Next button via the `onUploadingChange` effect above. */}
      </form>
    </Form>
  );
}
