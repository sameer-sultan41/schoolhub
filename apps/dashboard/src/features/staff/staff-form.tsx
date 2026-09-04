"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, collectPages } from "@schoolhub/api-client";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { mapFieldErrors } from "@/features/staff/map-field-errors";
import { staffSchema, type StaffFormValues } from "@/features/staff/staff-schema";
import type { StaffRecord } from "@/features/staff/staff-types";
import { useDesignations } from "@/features/staff/use-designations";
import { useCampuses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface DepartmentOption {
  id: string;
  name: string;
}

interface StaffFormProps {
  mode: "create" | "edit";
  staff?: StaffRecord;
}

const GENDERS: StaffFormValues["gender"][] = ["male", "female", "other", "unspecified"];
const STAFF_TYPES: StaffFormValues["staff_type"][] = ["teaching", "non_teaching"];
const EMPLOYMENT_TYPES: StaffFormValues["employment_type"][] = [
  "full_time",
  "part_time",
  "contract",
  "visiting",
];

export function StaffForm({ mode, staff }: StaffFormProps) {
  const t = useTranslations("staff");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const campuses = useCampuses();
  const designations = useDesignations();
  const departmentsQuery = useQuery({
    queryKey: queryKeys.list("staff", "departments"),
    queryFn: () => collectPages<DepartmentOption>(apiClient, "/departments"),
  });
  const employeeNumberFieldId = useId();

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      first_name: staff?.first_name ?? "",
      last_name: staff?.last_name ?? "",
      gender: staff?.gender ?? "unspecified",
      date_of_birth: staff?.date_of_birth ?? "",
      staff_type: staff?.staff_type ?? "teaching",
      campus_id: staff?.campus_id ?? "",
      department_id: staff?.department_id ?? "",
      designation_id: staff?.designation_id ?? "",
      employment_type: staff?.employment_type ?? "full_time",
      joining_date: staff?.joining_date ?? "",
      email: staff?.email ?? "",
      phone: staff?.phone ?? "",
      national_id: staff?.national_id ?? "",
      public_bio: staff?.public_bio ?? "",
    },
  });
  const { handleSubmit, setError } = form;

  const mutation = useMutation({
    mutationFn: async (values: StaffFormValues) => {
      const payload = {
        ...values,
        date_of_birth: values.date_of_birth || null,
        department_id: values.department_id || null,
        designation_id: values.designation_id || null,
        email: values.email || null,
        national_id: values.national_id || null,
        public_bio: values.public_bio || null,
      };
      const result =
        mode === "create"
          ? await apiClient.post<StaffRecord>("/staff", payload)
          : await apiClient.patch<StaffRecord>(`/staff/${staff?.id}`, payload);
      return result.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("staff") });
      // Write-through, not optimistic: the server's authoritative response
      // replaces whatever was cached, avoiding a refetch flash on the detail
      // screen the user is about to land on. Mirrors student-form.tsx exactly.
      queryClient.setQueryData(queryKeys.detail("staff", "staff", result.id), result);
      router.push(`/staff/${result.id}`);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof StaffFormValues, { type: "server", message: issue });
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
                console.error("Unexpected error while submitting the staff form:", error);
              });
            }}
            noValidate
          >
            {mode === "edit" && staff ? (
              // Not a real RHF field — a static, disabled display — see
              // student-form.tsx's identical admission_number block for why
              // this does NOT use FormItem/FormLabel.
              <div className="space-y-1.5">
                <label htmlFor={employeeNumberFieldId} className="text-sm font-medium">
                  {t("fields.employeeNumber")}
                </label>
                <Input id={employeeNumberFieldId} value={staff.employee_number} disabled readOnly />
                <p className="text-xs text-muted-foreground">{t("form.employeeNumberHint")}</p>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date_of_birth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.dateOfBirth")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="staff_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.staffType")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl required>
                        <SelectTrigger aria-label={t("fields.staffType")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STAFF_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`staffType.${value}`)}
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
                name="employment_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.employmentType")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl required>
                        <SelectTrigger aria-label={t("fields.employmentType")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EMPLOYMENT_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`employmentType.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                name="joining_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.joiningDate")}</FormLabel>
                    <FormControl required>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="department_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.department")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("fields.department")}>
                          <SelectValue placeholder={t("fields.none")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(departmentsQuery.data ?? []).map((department) => (
                          <SelectItem key={department.id} value={department.id}>
                            {department.name}
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
                name="designation_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.designation")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("fields.designation")}>
                          <SelectValue placeholder={t("fields.none")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(designations.data ?? []).map((designation) => (
                          <SelectItem key={designation.id} value={designation.id}>
                            {designation.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.email")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.phone")}</FormLabel>
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
              name="national_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.nationalId")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="public_bio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.publicBio")}</FormLabel>
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
