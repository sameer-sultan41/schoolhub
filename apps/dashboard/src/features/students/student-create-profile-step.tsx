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
  /** Called once `createStudent` succeeds. The stepper advances to Guardians on
   * this — this component never navigates or closes anything itself. */
  onCreated: (student: { id: string; campusId: string; name: string }) => void;
  /** Passthrough of `StudentPhotoField`'s own upload-in-flight state, so the
   * stepper's external Next button can disable itself during an upload. */
  onUploadingChange: (uploading: boolean) => void;
}

/**
 * The Profile step of `StudentCreateStepper` — the create-only half of
 * `student-form-dialog.tsx`'s form, with the dialog chrome and every edit-mode
 * branch (detail fetch, `populatedStudentId`, photo-upload session tracking tied to
 * an existing `studentId`) removed, since this component only ever creates a brand
 * new student. The double-submit guard (`isSubmittingRef`) is kept exactly as-is —
 * Review Focus #1 names this as the one behavior that must carry over unchanged.
 */
export function StudentCreateProfileStep({
  onCreated,
  onUploadingChange,
}: StudentCreateProfileStepProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
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

  const mutation = useMutation({
    mutationFn: (values: StudentFormValues) =>
      Services.students.createStudent(buildStudentInput(values, "create")),
    onSuccess: (student) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      onCreated({
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

  // `StudentPhotoField` calls this as an upload starts. There is no existing
  // studentId yet to guard against a reopen-with-different-id race the way
  // `student-form-dialog.tsx` does (Review Focus there, not here — this component
  // is always a single, one-shot create, never reused across different students
  // the way the edit dialog is reused across rows) — a fresh component instance per
  // wizard open (`StudentCreateStepper`'s own "fresh instance per open" convention,
  // Task 3) already gives every upload a session that can't outlive its own mount.
  function captureUploadSession() {
    return () => true;
  }

  function onSubmit(event: SyntheticEvent) {
    if (isSubmittingRef.current) return;
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

  return (
    <Form {...form}>
      <form id="student-create-profile-step" noValidate onSubmit={onSubmit}>
        {formError && (
          <Alert variant="destructive" className="mb-4">
            {formError}
          </Alert>
        )}
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
              savedRecord={undefined}
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
        {/* No footer here — `StudentCreateStepper` renders the shared Back/Next
            footer outside this step and submits this form via its `id` attribute
            above, the same way a dialog footer button outside a `<form>` submits it
            via the HTML `form="..."` attribute. `isPhotoUploading` reaches that
            external Next button via the `onUploadingChange` effect above. */}
      </form>
    </Form>
  );
}
