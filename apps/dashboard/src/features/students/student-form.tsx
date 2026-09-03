"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
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
  Textarea,
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { mapFieldErrors } from "@/features/students/map-field-errors";
import { studentSchema, type StudentFormValues } from "@/features/students/student-schema";
import type { StudentRecord } from "@/features/students/student-types";
import { useCampuses, useHouses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface StudentFormProps {
  mode: "create" | "edit";
  student?: StudentRecord;
}

const GENDERS: StudentFormValues["gender"][] = ["male", "female", "other", "unspecified"];

export function StudentForm({ mode, student }: StudentFormProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const campuses = useCampuses();
  const houses = useHouses();
  const admissionNumberFieldId = useId();

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      first_name: student?.first_name ?? "",
      last_name: student?.last_name ?? "",
      preferred_name: student?.preferred_name ?? "",
      date_of_birth: student?.date_of_birth ?? "",
      gender: student?.gender ?? "unspecified",
      campus_id: student?.campus_id ?? "",
      house_id: student?.house_id ?? "",
      admission_date: student?.admission_date ?? "",
      blood_group: student?.blood_group ?? "",
      nationality: student?.nationality ?? "",
      religion: student?.religion ?? "",
      previous_school: student?.previous_school ?? "",
      medical_notes: student?.medical_notes ?? "",
    },
  });
  const { handleSubmit, setError } = form;

  const mutation = useMutation({
    mutationFn: async (values: StudentFormValues) => {
      const payload = {
        ...values,
        preferred_name: values.preferred_name || null,
        house_id: values.house_id || null,
        blood_group: values.blood_group || null,
        nationality: values.nationality || null,
        religion: values.religion || null,
        previous_school: values.previous_school || null,
        medical_notes: values.medical_notes || null,
      };
      const result =
        mode === "create"
          ? await apiClient.post<StudentRecord>("/students", payload)
          : await apiClient.patch<StudentRecord>(`/students/${student?.id}`, payload);
      return result.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      // Write-through, not optimistic: the server's authoritative response
      // replaces whatever was cached, avoiding a refetch flash on the detail
      // screen the user is about to land on.
      queryClient.setQueryData(queryKeys.detail("students", "students", result.id), result);
      router.push(`/students/${result.id}`);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof StudentFormValues, { type: "server", message: issue });
      }
      if (unknown.length > 0) {
        setError("root", { type: "server", message: unknown.join(" ") });
      }
    },
  });

  const formError =
    mutation.error instanceof ApiError && !mutation.error.isValidation
      ? tErrors.has(mutation.error.code)
        ? tErrors(mutation.error.code)
        : mutation.error.message
      : (form.formState.errors.root?.message ?? null);

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        {formError ? (
          <Alert variant="danger">
            <AlertDescription>
              {formError}
              {mutation.error instanceof ApiError && mutation.error.requestId
                ? ` ${tErrors("requestId", { requestId: mutation.error.requestId })}`
                : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while submitting the student form:", error);
              });
            }}
            noValidate
          >
            {mode === "edit" && student ? (
              // Not a real RHF field — a static, disabled display — so this
              // deliberately does NOT use FormItem/FormLabel: both call
              // useFormField(), which requires a <FormField> (Controller)
              // context this value has no binding to.
              <div className="space-y-1.5">
                <label htmlFor={admissionNumberFieldId} className="text-sm font-medium">
                  {t("fields.admissionNumber")}
                </label>
                <Input
                  id={admissionNumberFieldId}
                  value={student.admission_number}
                  disabled
                  readOnly
                />
                <p className="text-xs text-muted-foreground">{t("form.admissionNumberHint")}</p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.firstName")}</FormLabel>
                    <FormControl required>
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
                    <FormLabel required>{t("fields.lastName")}</FormLabel>
                    <FormControl required>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="preferred_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.preferredName")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date_of_birth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.dateOfBirth")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="admission_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.admissionDate")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.gender")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.gender")}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GENDERS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`gender.${value}`)}
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
                control={form.control}
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
              <FormField
                control={form.control}
                name="house_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.house")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("fields.house")}>
                          <SelectValue placeholder={t("fields.none")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(houses.data ?? []).map((house) => (
                          <SelectItem key={house.id} value={house.id}>
                            {house.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="blood_group"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.bloodGroup")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nationality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.nationality")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="religion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.religion")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="previous_school"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.previousSchool")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="medical_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.medicalNotes")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              isLoading={mutation.isPending}
              loadingLabel={t("form.submitting")}
            >
              {mode === "create" ? t("form.createTitle") : t("form.editTitle")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
