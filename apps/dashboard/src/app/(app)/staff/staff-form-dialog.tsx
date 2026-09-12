"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Services } from "@/services";
import type { CreateStaffInput, StaffDetailRecord } from "@/services/modules/dashboard/dashboard-service";

/**
 * One dialog, two jobs: creating a brand-new staff member and editing an existing one.
 * Task 5 renders this once from `staff-toolbar.tsx`'s "Add Member" button (`mode:
 * "create"`) and once from `staff-directory-table.tsx`'s row ⋮ "Edit" item (`mode:
 * "edit"`, `staffId`) — this file owns the exported prop contract both call sites depend
 * on, and stays fully controlled (no internal open/close state) so either can drive it.
 *
 * No i18n wiring here, matching the rest of `/staff` (see staff-directory-table.tsx's own
 * comment) — hardcoded English throughout is this route's established convention, not an
 * oversight.
 */
export interface StaffFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Required when `mode === "edit"`, ignored when `mode === "create"`. */
  staffId?: string;
}

/**
 * Real enum values, verified against `apps/api/apps/staff_management/models.py` — used
 * verbatim as each `<Select>`'s options, never invented client-side.
 */
const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "unspecified", label: "Unspecified" },
];

const STAFF_TYPE_OPTIONS = [
  { value: "teaching", label: "Teaching" },
  { value: "non_teaching", label: "Non-teaching" },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "visiting", label: "Visiting" },
];

/**
 * Sentinel for "no department/designation/manager/employment type" in a `<Select>` —
 * Radix disallows a real `<SelectItem value="">`, so an explicit "None" choice needs a
 * non-empty value of its own. `buildStaffInput` below maps both this and a genuinely
 * untouched `""` back to `undefined` (the key omitted from the request body) before
 * anything is sent to `createStaff`/`updateStaff`.
 */
const UNSET_VALUE = "unset";

const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

/**
 * Field names are snake_case (matching the API's own field names) rather than this
 * codebase's usual camelCase, deliberately — `error.fieldErrors()` keys come back
 * snake_case from the server, and matching them 1:1 here means the server-error-mapping
 * loop below needs no re-mapping step, mirroring `login-form.tsx`'s pattern.
 *
 * Every required/optional split matches the real `create_staff` service signature
 * (`apps/api/apps/staff_management/services.py`) exactly: `campus_id`, `joining_date`,
 * `first_name`, `last_name`, `staff_type`, `phone` required; everything else optional.
 * Zod here is instant client-side feedback only — the API remains the authority (it
 * still enforces things like `national_id` uniqueness or `reports_to` cycles that
 * Zod deliberately does not re-implement).
 */
const staffFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  photo_file_id: z.string().optional(),
  staff_type: z.string().min(1),
  campus_id: z.string().min(1),
  department_id: z.string().optional(),
  designation_id: z.string().optional(),
  reports_to_staff_id: z.string().optional(),
  employment_type: z.string().optional(),
  joining_date: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().optional(),
  national_id: z.string().optional(),
  public_bio: z.string().optional(),
  // Not `.optional()` at this level, unlike every other optional field above: this
  // form's own default values (both `EMPTY_DEFAULTS` and `detailToFormValues`) always
  // populate a full address object (each sub-field an empty string when unset), so
  // `address` itself is never actually absent — only its individual sub-fields are.
  address: addressSchema,
});

type StaffFormValues = z.infer<typeof staffFormSchema>;

const EMPTY_DEFAULTS: StaffFormValues = {
  first_name: "",
  last_name: "",
  gender: "",
  date_of_birth: "",
  photo_file_id: "",
  staff_type: "",
  campus_id: "",
  department_id: "",
  designation_id: "",
  reports_to_staff_id: "",
  employment_type: "",
  joining_date: "",
  phone: "",
  email: "",
  national_id: "",
  public_bio: "",
  address: { line1: "", line2: "", city: "", state: "", postal_code: "", country: "" },
};

/** This form's own field names — the server-error-mapping loop only ever calls
 * `setError` for a field name that is actually one of these. */
const FORM_FIELD_NAMES = new Set(Object.keys(EMPTY_DEFAULTS));

/**
 * `detail.address` is a schema-less JSON blob server-side (`models.JSONField(null=True,
 * blank=True)`) — this form's own chosen shape (`line1/line2/city/state/postal_code/
 * country`, all optional strings) is read back best-effort from whatever keys happen to
 * be there; a key that isn't a string, or isn't present, reads as `""`.
 */
function addressFromDetail(address: Record<string, unknown> | null): StaffFormValues["address"] {
  const source = address ?? {};
  const asString = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    line1: asString(source.line1),
    line2: asString(source.line2),
    city: asString(source.city),
    state: asString(source.state),
    postal_code: asString(source.postal_code),
    country: asString(source.country),
  };
}

/** Maps a fetched `StaffDetailRecord` onto this form's own field shape — `null` on a
 * relation/enum field becomes `UNSET_VALUE` (an explicit "None" the user can see and
 * change) rather than `""` (indistinguishable from "still loading"). */
function detailToFormValues(detail: StaffDetailRecord): StaffFormValues {
  return {
    first_name: detail.first_name,
    last_name: detail.last_name,
    gender: detail.gender ?? "",
    date_of_birth: detail.date_of_birth ?? "",
    photo_file_id: detail.photo_file_id ?? "",
    staff_type: detail.staff_type,
    campus_id: detail.campus_id,
    department_id: detail.department_id ?? UNSET_VALUE,
    designation_id: detail.designation_id ?? UNSET_VALUE,
    reports_to_staff_id: detail.reports_to_staff_id ?? UNSET_VALUE,
    employment_type: detail.employment_type ?? UNSET_VALUE,
    joining_date: detail.joining_date,
    phone: detail.phone,
    email: detail.email ?? "",
    national_id: detail.national_id ?? "",
    public_bio: detail.public_bio ?? "",
    address: addressFromDetail(detail.address),
  };
}

/**
 * Every optional field maps a genuinely untouched `""` (or the `UNSET_VALUE` sentinel)
 * to `undefined` — the key omitted from the request body — rather than sending an empty
 * string through. This is a deliberate, uniform simplification: `CreateStaffInput`/
 * `UpdateStaffInput` (Task 2) type every optional field as `string | undefined`, with no
 * `null` arm, so there is no wire-level way to say "clear this back to empty" through
 * these functions as they exist today. Rather than sending a raw `""` for some fields
 * (risky for an FK/enum-shaped one — `department_id: ""`/`gender: ""` is likely a 400)
 * and not others, every optional field is treated the same: this form can set or change
 * an optional field, but cannot explicitly blank one back out. See the task report for
 * the full reasoning.
 */
function optional(value: string): string | undefined {
  return value === "" || value === UNSET_VALUE ? undefined : value;
}

function buildAddress(address: StaffFormValues["address"]): Record<string, unknown> | undefined {
  const entries = Object.entries(address).filter(
    ([, value]) => typeof value === "string" && value.trim() !== "",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildStaffInput(values: StaffFormValues): CreateStaffInput {
  return {
    campusId: values.campus_id,
    joiningDate: values.joining_date,
    firstName: values.first_name,
    lastName: values.last_name,
    staffType: values.staff_type as CreateStaffInput["staffType"],
    phone: values.phone,
    departmentId: optional(values.department_id ?? ""),
    designationId: optional(values.designation_id ?? ""),
    reportsToStaffId: optional(values.reports_to_staff_id ?? ""),
    photoFileId: optional(values.photo_file_id ?? ""),
    gender: optional(values.gender ?? ""),
    dateOfBirth: optional(values.date_of_birth ?? ""),
    employmentType: optional(values.employment_type ?? ""),
    email: optional(values.email ?? ""),
    nationalId: optional(values.national_id ?? ""),
    publicBio: optional(values.public_bio ?? ""),
    address: buildAddress(values.address),
  };
}

/** Same convention as `staff-directory-table.tsx`'s own `initialsOf` — duplicated
 * rather than imported, since that one is private to its own module. */
function initialsOf(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/).filter(Boolean);
  if (!first) return "?";
  const last = rest.at(-1);
  return last ? `${first[0]}${last[0]}`.toUpperCase() : first.slice(0, 2).toUpperCase();
}

export function StaffFormDialog({ open, onOpenChange, mode, staffId }: StaffFormDialogProps) {
  const queryClient = useQueryClient();
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // `handlePhotoChange` is an ordinary async closure re-created every render, so a plain
  // `open` read inside it after an `await` sees the value from WHEN THE UPLOAD STARTED,
  // never a later close — a closed-over prop can't observe a subsequent render. A ref
  // updated on every render is the standard escape hatch: reading `openRef.current` after
  // the await always reflects the dialog's current state, not the one from when the
  // in-flight call was kicked off.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Gated on `open` so the dialog never fetches any of these before it's ever opened.
  const campusesQuery = useQuery({
    queryKey: ["staff", "form", "campuses"],
    queryFn: () => Services.dashboard.fetchCampuses(),
    enabled: open,
  });
  const departmentsQuery = useQuery({
    queryKey: ["staff", "form", "departments"],
    queryFn: () => Services.dashboard.fetchDepartments(),
    enabled: open,
  });
  const designationsQuery = useQuery({
    queryKey: ["staff", "form", "designations"],
    queryFn: () => Services.dashboard.fetchDesignations(),
    enabled: open,
  });
  // The "Reports to" dropdown's option source — bounded to 100 staff, same as
  // `teams.tsx`'s dashboard-home preview.
  const staffDirectoryQuery = useQuery({
    queryKey: ["staff", "form", "directory"],
    queryFn: () => Services.dashboard.fetchStaffDirectory(),
    enabled: open,
  });

  const staffDetailQuery = useQuery({
    queryKey: ["staff", "detail", staffId],
    queryFn: () => Services.dashboard.fetchStaffById(staffId as string),
    enabled: mode === "edit" && open && Boolean(staffId),
  });

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  // Deliberately NOT react-hook-form's `values` prop: `values` syncs against RHF's own
  // cached `_values.current` ref via deep-equality, and that ref is never cleared when
  // `values` reverts to `undefined` on close — so reopening Edit for the SAME staff member
  // after closing once would be silently skipped as "already applied" (RHF sees a
  // deep-equal object to what it cached the first time) and the form would stay blank.
  // An explicit imperative `reset` here has no such cache, so it re-applies every time.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && staffDetailQuery.data) {
      form.reset(detailToFormValues(staffDetailQuery.data));
    }
  }, [open, mode, staffDetailQuery.data, form]);

  // Closing the dialog (Cancel, Escape, overlay click, or a successful submit calling
  // `onOpenChange(false)`) resets every bit of this form's own state — so reopening it
  // (edit A, close, then create, or edit A then edit B) never leaks stale values.
  useEffect(() => {
    if (!open) {
      form.reset(EMPTY_DEFAULTS);
      setLocalPreviewUrl(null);
      setUploadStatus("idle");
      setUploadError(null);
    }
  }, [open, form]);

  // Revokes the previous object URL whenever a new one is created, and the last one on
  // unmount — `localPreviewUrl` is the only object URL this component ever holds live.
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  const mutation = useMutation({
    mutationFn: (values: StaffFormValues) => {
      const input = buildStaffInput(values);
      return mode === "create"
        ? Services.dashboard.createStaff(input)
        : Services.dashboard.updateStaff(staffId as string, input);
    },
    onSuccess: () => {
      // A prefix match (TanStack Query v5's `invalidateQueries` default, `exact: false`)
      // catches every `["staff", ...]` key this route uses — the directory table
      // (`["staff", "directory", ...]`), the toolbar's two stat queries (`["staff",
      // "toolbar", ...]`), and this dialog's own reference-data/detail queries — so a
      // newly created staff member is immediately selectable as someone else's "Reports
      // to" option too, without a page reload.
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
      onOpenChange(false);
      toast.success(mode === "create" ? "Staff member added" : "Staff member updated");
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      for (const [field, issue] of Object.entries(error.fieldErrors())) {
        if (FORM_FIELD_NAMES.has(field)) {
          form.setError(field as keyof StaffFormValues, { type: "server", message: issue });
        }
      }
    },
  });

  // A field-level error already has somewhere to show (the matching FormMessage above),
  // so the fallback banner below is reserved for whatever a field can't display: a
  // transport failure, a 5xx, or a detail keyed to something this form doesn't render as
  // a field at all (e.g. a `non_field`-keyed domain-rule violation) — mirrors
  // `login-form.tsx`'s own `formError`, minus the i18n lookup this route doesn't have
  // (see this file's own top comment on that).
  const mutationError = mutation.error;
  const hasMappedFieldError =
    mutationError instanceof ApiError &&
    Object.keys(mutationError.fieldErrors()).some((field) => FORM_FIELD_NAMES.has(field));
  const formError =
    mutationError instanceof ApiError && !hasMappedFieldError
      ? mutationError.isUnauthenticated
        ? "Your session has expired. Sign in again."
        : mutationError.message
      : null;

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file later (e.g. after a failed upload) — the browser
    // otherwise treats an unchanged file input value as "no change", firing no event.
    event.target.value = "";
    if (!file) return;

    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(URL.createObjectURL(file));
    setUploadStatus("uploading");
    setUploadError(null);

    try {
      const fileId = await Services.files.uploadFile(file, "staff.photo");
      // The dialog may have been closed (and possibly reopened for a different staff
      // member, or in create mode) while this upload was in flight — writing into the
      // form at that point would silently leak this resolved upload into whatever the
      // dialog now shows, so bail out rather than call setValue on a closed dialog.
      // Reads `openRef.current`, not the closed-over `open` param: this function's own
      // closure was created back when the upload started, so a bare `open` here would
      // always see that render's value, never a close that happened during the `await`.
      if (!openRef.current) return;
      form.setValue("photo_file_id", fileId, { shouldDirty: true });
      setUploadStatus("idle");
    } catch (error) {
      setUploadStatus("error");
      setUploadError(
        error instanceof Error ? error.message : "The photo could not be uploaded.",
      );
    }
  }

  const firstName = form.watch("first_name");
  const lastName = form.watch("last_name");
  const photoFileId = form.watch("photo_file_id");
  const isDetailLoading = mode === "edit" && staffDetailQuery.isPending;

  const reportsToOptions = (staffDirectoryQuery.data ?? []).filter(
    (staff) => !(mode === "edit" && staff.id === staffId),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" closeLabel="Close">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add staff member" : "Edit staff member"}</DialogTitle>
        </DialogHeader>

        {isDetailLoading ? (
          <DialogBody>
            <p className="text-sm text-muted-foreground">Loading staff details…</p>
          </DialogBody>
        ) : (
          <Form {...form}>
            <form
              // See login-form.tsx's own comment on this exact pattern: handleSubmit's
              // wrapper is promise-returning where the DOM expects void, and a genuinely
              // unexpected throw inside the resolver (not a validation failure, which
              // react-hook-form resolves internally via setError) would otherwise vanish
              // as an unhandled rejection with nothing here to say so.
              onSubmit={(event) => {
                form
                  .handleSubmit((values) => {
                    mutation.mutate(values);
                  })(event)
                  .catch((error: unknown) => {
                    console.error("Unexpected error while submitting the staff form:", error);
                  });
              }}
              noValidate
            >
              <DialogBody className="max-h-[65vh] space-y-5 overflow-y-auto pe-1">
                {formError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>First name</FormLabel>
                        <FormControl required>
                          <Input {...field} autoFocus />
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
                        <FormLabel required>Last name</FormLabel>
                        <FormControl required>
                          <Input {...field} />
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
                        <FormLabel>Gender</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {GENDER_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
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
                    name="date_of_birth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of birth</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2 sm:col-span-2">
                    {/* A section heading, not a form label for one control — the
                        file input already carries its own `aria-label`, and this
                        group also contains the read-only avatar preview. Plain text
                        matching `Label`'s own typography, not the `Label` component
                        itself (which renders a real `<label>` needing an associated
                        control). */}
                    <p className="text-sm font-medium text-foreground">Photo</p>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-12 shrink-0">
                        {localPreviewUrl ? <AvatarImage src={localPreviewUrl} alt="" /> : null}
                        <AvatarFallback>{initialsOf(`${firstName} ${lastName}`)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-1">
                        <Input
                          type="file"
                          accept="image/jpeg,image/png"
                          aria-label="Staff photo"
                          onChange={(event) => {
                            void handlePhotoChange(event);
                          }}
                          disabled={uploadStatus === "uploading"}
                        />
                        {uploadStatus === "uploading" ? (
                          <p className="text-xs text-muted-foreground">Uploading…</p>
                        ) : null}
                        {uploadStatus === "error" && uploadError ? (
                          <p className="text-xs text-destructive" role="alert">
                            {uploadError}
                          </p>
                        ) : null}
                        {uploadStatus !== "uploading" && !localPreviewUrl && photoFileId ? (
                          <p className="text-xs text-muted-foreground">Photo on file</p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="staff_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>Staff type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl required>
                            <SelectTrigger>
                              <SelectValue placeholder="Select staff type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {STAFF_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
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
                        <FormLabel required>Campus</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={campusesQuery.isPending}
                        >
                          <FormControl required>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={campusesQuery.isPending ? "Loading…" : "Select campus"}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(campusesQuery.data ?? []).map((campus) => (
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
                    name="department_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={departmentsQuery.isPending}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  departmentsQuery.isPending ? "Loading…" : "Select department"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={UNSET_VALUE}>None</SelectItem>
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
                        <FormLabel>Designation</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={designationsQuery.isPending}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  designationsQuery.isPending ? "Loading…" : "Select designation"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={UNSET_VALUE}>None</SelectItem>
                            {(designationsQuery.data ?? []).map((designation) => (
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

                  <FormField
                    control={form.control}
                    name="reports_to_staff_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reports to</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={staffDirectoryQuery.isPending}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  staffDirectoryQuery.isPending ? "Loading…" : "Select manager"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={UNSET_VALUE}>None</SelectItem>
                            {reportsToOptions.map((staff) => (
                              <SelectItem key={staff.id} value={staff.id}>
                                {`${staff.first_name} ${staff.last_name}`}
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
                        <FormLabel>Employment type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select employment type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={UNSET_VALUE}>None</SelectItem>
                            {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
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
                        <FormLabel required>Joining date</FormLabel>
                        <FormControl required>
                          <Input type="date" {...field} />
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
                        <FormLabel required>Phone</FormLabel>
                        <FormControl required>
                          <Input {...field} type="tel" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="national_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>National ID</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3">
                  {/* Section heading for the whole group, same reasoning as "Photo"
                      above — not a label for any single one of the six inputs below. */}
                  <p className="text-sm font-medium text-foreground">Address</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="address.line1"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Line 1</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address.line2"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Line 2</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address.city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address.state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State / province</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address.postal_code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postal code</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address.country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="public_bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Public bio</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </DialogBody>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={mutation.isPending}
                  loadingLabel={mode === "create" ? "Adding…" : "Saving…"}
                  disabled={uploadStatus === "uploading"}
                >
                  {mode === "create" ? "Add member" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
