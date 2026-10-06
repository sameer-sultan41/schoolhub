"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { RELATIONSHIP_VALUES, type RelationshipValue } from "@schoolhub/types";
import {
  Alert,
  Button,
  Form,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors, resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { formValuesToCreateGuardianInput } from "@/services/modules/guardians/guardians-helper";
import {
  guardianFormSchema,
  type GuardianFormValues,
} from "@/services/modules/guardians/guardians.schema";
import { GuardianFormFields } from "./guardian-form-dialog";

export interface GuardianPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  /** This student's already-linked guardians' ids — hidden from search results, since
   * picking one would only ever hit the backend's duplicate-link conflict. */
  excludedGuardianIds?: string[];
  /** `true` when the student currently has zero guardian links — the one being linked
   * now becomes primary by default (module doc §11), not left for a separate action. */
  isFirstGuardian?: boolean;
  onLinked: () => void;
}

export function GuardianPickerDialog({
  open,
  onOpenChange,
  studentId,
  excludedGuardianIds = [],
  isFirstGuardian = false,
  onLinked,
}: GuardianPickerDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.link")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <GuardianPickerBody
            key={studentId}
            studentId={studentId}
            excludedGuardianIds={excludedGuardianIds}
            isFirstGuardian={isFirstGuardian}
            onOpenChange={onOpenChange}
            onLinked={onLinked}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface GuardianPickerBodyProps {
  studentId: string;
  excludedGuardianIds: string[];
  isFirstGuardian: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}

const CREATE_DEFAULTS: GuardianFormValues = {
  first_name: "",
  last_name: "",
  phone: "",
  alt_phone: "",
  email: "",
  photo_file_id: "",
};

function GuardianPickerBody({
  studentId,
  excludedGuardianIds,
  isFirstGuardian,
  onOpenChange,
  onLinked,
}: GuardianPickerBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"choose" | "link">("choose");
  const [tab, setTab] = useState<"search" | "create">("search");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [selectedGuardian, setSelectedGuardian] = useState<GuardianRecord | null>(null);
  // Whether `selectedGuardian` came from THIS open session's own create-tab submission —
  // distinct from a search pick. Guardians have no delete endpoint, so re-submitting the
  // create form a second time for the same person is a PERMANENT duplicate record
  // (round-6 review finding); once a guardian has actually been created, the "link" step
  // below never offers a way back into the create form, closing that path off entirely
  // rather than trying to reset or disable it correctly.
  const [justCreated, setJustCreated] = useState(false);
  const [relationship, setRelationship] = useState<RelationshipValue | "">("");
  // Gates the "required" message below — without it, the message shows the instant this
  // step renders, before the user has had any chance to pick a relationship at all.
  const [linkAttempted, setLinkAttempted] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const excluded = new Set(excludedGuardianIds);
  const searchQuery = useQuery({
    queryKey: queryKeys.list("guardians", "search", { search }),
    queryFn: () => Services.guardians.searchGuardians(search),
    enabled: step === "choose" && tab === "search" && search.length > 0,
  });
  const searchResults = (searchQuery.data ?? []).filter((g) => !excluded.has(g.id));

  const createForm = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianFormSchema),
    defaultValues: CREATE_DEFAULTS,
  });
  const createSubmitGuard = useSubmitGuard();

  const createMutation = useMutation({
    mutationFn: (values: GuardianFormValues) =>
      Services.guardians.createGuardian(formValuesToCreateGuardianInput(values)),
    onSuccess: (created) => {
      setSelectedGuardian(created);
      setJustCreated(true);
      setStep("link");
    },
    onError: (error) => {
      // Same shared field-error-mapping helper as `GuardianFormDialog` (Task 5) — this
      // form shares `guardianFormSchema`, so a 422's snake_case field keys already match
      // the form's own field names with no translation needed.
      applyServerFieldErrors({
        error,
        form: createForm,
        knownFields: Object.keys(guardianFormSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError: setCreateError,
      });
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (guardianId: string) => {
      if (!relationship) throw new Error("relationship is required");
      return Services.guardians.linkGuardianToStudent(studentId, {
        guardianId,
        relationship,
        isPrimary: isFirstGuardian,
        isFeeResponsible: false,
        canPickUp: true,
        receivesCommunications: true,
        hasPortalAccess: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "guardian-links", { studentId }),
      });
      onOpenChange(false);
      onLinked();
    },
    onError: (error) => {
      setLinkError(
        error instanceof ApiError
          ? resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field")
          : t("form.submitFailed"),
      );
    },
  });

  function selectSearchResult(guardian: GuardianRecord) {
    setSelectedGuardian(guardian);
    setJustCreated(false);
    setStep("link");
  }

  function backToChoose() {
    // Never reachable once `justCreated` is true — the link step below doesn't render
    // this function's caller (the "Edit" button) in that case, so a freshly created
    // guardian is never resubmittable. Reset `tab`/`createForm` anyway, defensively: if
    // a future change ever wires another caller to this function, it must not silently
    // reopen the create tab with stale, already-submitted values.
    setStep("choose");
    setTab("search");
    setSelectedGuardian(null);
    setJustCreated(false);
    setRelationship("");
    setLinkAttempted(false);
    setLinkError(null);
    createForm.reset(CREATE_DEFAULTS);
  }

  function handleLink() {
    setLinkAttempted(true);
    setLinkError(null);
    if (!relationship) return;
    if (selectedGuardian) linkMutation.mutate(selectedGuardian.id);
  }

  if (step === "link" && selectedGuardian) {
    return (
      <>
        <ResponsiveDialogBody className="space-y-4">
          {linkError && <Alert variant="destructive">{linkError}</Alert>}
          <div className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>
              {selectedGuardian.first_name} {selectedGuardian.last_name}
            </span>
            {/* No "Edit"/back affordance once a guardian was just created here: going back
             * to the create tab would resubmit the same form and create a second,
             * permanent record (guardians have no delete endpoint) — see `justCreated`'s
             * own comment above. A search-selected guardian can still be changed. */}
            {!justCreated ? (
              <Button type="button" variant="link" className="h-auto p-0" onClick={backToChoose}>
                {tCommon("edit")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("guardians.permanentNotice")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="picker-relationship">{t("guardians.fields.relationship")}</Label>
            <Select
              value={relationship}
              onValueChange={(value) => {
                setRelationship(value as RelationshipValue);
              }}
            >
              <SelectTrigger
                id="picker-relationship"
                aria-label={t("guardians.fields.relationship")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`guardians.relationship.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkAttempted && !relationship ? (
              <p className="text-sm text-destructive">{tCommon("requiredField")}</p>
            ) : null}
          </div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!relationship || linkMutation.isPending}
            isLoading={linkMutation.isPending}
            loadingLabel={t("guardians.linking")}
            onClick={handleLink}
          >
            {t("guardians.link")}
          </Button>
        </ResponsiveDialogFooter>
      </>
    );
  }

  return (
    <>
      <ResponsiveDialogBody className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("guardians.linkDescription")}</p>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as "search" | "create");
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="search">{t("guardians.searchExisting")}</TabsTrigger>
            <TabsTrigger value="create">{t("guardians.createNew")}</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-2">
            <Input
              aria-label={t("guardians.searchPlaceholder")}
              placeholder={t("guardians.searchPlaceholder")}
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
            />
            {searchQuery.isFetching ? <Skeleton className="h-9 w-full" /> : null}
            {search.length > 0 && !searchQuery.isFetching && searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("guardians.searchEmpty")}</p>
            ) : null}
            {searchResults.length > 0 ? (
              <Select
                value=""
                onValueChange={(value) => {
                  const picked = searchResults.find((g) => g.id === value);
                  if (picked) selectSearchResult(picked);
                }}
              >
                {/* Distinct from the search input's own accessible name above, which
                 * describes typing a query, not choosing from its results. */}
                <SelectTrigger aria-label={t("guardians.searchExisting")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {searchResults.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.first_name} {g.last_name} · {g.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </TabsContent>

          <TabsContent value="create" className="space-y-3">
            {/* The create form's own fields, inlined — no nested dialog. Submitting
             * advances straight to the link step via createMutation's onSuccess above. */}
            <Form {...createForm}>
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void createSubmitGuard.guard(
                    () =>
                      new Promise<void>((resolve) => {
                        createForm
                          .handleSubmit(
                            (values) => {
                              setCreateError(null);
                              createMutation.mutate(values, { onSettled: resolve });
                            },
                            () => {
                              resolve();
                            },
                          )(event)
                          .catch((error: unknown) => {
                            console.error(error);
                            resolve();
                          });
                      }),
                  );
                }}
                className="space-y-3"
              >
                {createError && <Alert variant="destructive">{createError}</Alert>}
                <GuardianFormFields
                  form={createForm}
                  onUploadStart={() => () => true}
                  onUploadingChange={setIsPhotoUploading}
                />
                <Button
                  type="submit"
                  isLoading={createMutation.isPending || isPhotoUploading}
                  loadingLabel={t("guardians.submitting")}
                  className="w-full"
                >
                  {t("guardians.createGuardian")}
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {tCommon("cancel")}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
