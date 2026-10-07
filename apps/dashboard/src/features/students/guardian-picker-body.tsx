"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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

import { ResponsiveDialogBody, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useGuardedSubmit, useSubmitGuard } from "@/hooks/use-submit-guard";
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

/**
 * `GuardianPickerDialog`'s actual content, split into its own file so that file stays
 * under the 400-line `max-lines` ESLint cap — this is the bulk of its logic (search,
 * create, link), while `guardian-picker-dialog.tsx` keeps only the `ResponsiveDialog`
 * shell and this component's prop contract. Mirrors `guardian-form-dialog.tsx` already
 * exporting `GuardianFormFields` for a sibling file to import, the same pattern in
 * reverse.
 */
export interface GuardianPickerBodyProps {
  studentId: string;
  excludedGuardianIds: string[];
  isFirstGuardian: boolean;
  resumeGuardian: GuardianRecord | null;
  onGuardianCreated?: (guardian: GuardianRecord) => void;
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

export function GuardianPickerBody({
  studentId,
  excludedGuardianIds,
  isFirstGuardian,
  resumeGuardian,
  onGuardianCreated,
  onOpenChange,
  onLinked,
}: GuardianPickerBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  // `resumeGuardian` seeds every one of these rather than running through an effect:
  // the caller only ever renders this body at all while the dialog is open (the
  // `{open ? <GuardianPickerBody ... /> : null}` above), so every open is already a
  // fresh mount and these initializers run exactly once per real open — the same
  // reasoning `GuardianLinkFlagsDialog`'s own "no reset-on-open effect" comment uses.
  const [step, setStep] = useState<"choose" | "link">(resumeGuardian ? "link" : "choose");
  const [tab, setTab] = useState<"search" | "create">("search");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [selectedGuardian, setSelectedGuardian] = useState<GuardianRecord | null>(resumeGuardian);
  // Whether `selectedGuardian` came from a create-tab submission (this open, or a prior
  // one resumed via `resumeGuardian`) — distinct from a search pick. Guardians have no
  // delete endpoint, so re-submitting the create form a second time for the same person
  // is a PERMANENT duplicate record (round-6 review finding); once a guardian has
  // actually been created, the "link" step below never offers a way back into the
  // create form, closing that path off entirely rather than trying to reset or disable
  // it correctly. Closing this dialog after creating but before linking no longer loses
  // that guardian either (round-8 review finding): `onGuardianCreated` below hands its
  // id up to `StudentGuardiansTab`, which passes it back as `resumeGuardian` the next
  // time this dialog opens, landing straight back here instead of back at "choose".
  const [justCreated, setJustCreated] = useState(Boolean(resumeGuardian));
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
      // Tell the caller BEFORE anything else can go wrong (a later link failure, the
      // user closing the dialog): the guardian already exists server-side the moment
      // this resolves, so `StudentGuardiansTab` must remember its id from this point on.
      onGuardianCreated?.(created);
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

  const handleCreateSubmit = useGuardedSubmit(
    createForm,
    createSubmitGuard,
    (values) =>
      new Promise<void>((resolve) => {
        setCreateError(null);
        createMutation.mutate(values, {
          onSettled: () => {
            resolve();
          },
        });
      }),
  );

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
      // Invalidating `guardian-links` is `onLinked`'s job — the caller's own single
      // source of truth for refetching after a link (`StudentGuardiansTab.invalidateLinks`,
      // the same callback `GuardianLinkFlagsDialog.onSaved` and `GuardianFormDialog.onSaved`
      // already rely on). Invalidating it here too was a redundant second
      // invalidate-and-refetch of the exact same query key (round-7 review finding).
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
              <Button type="button" mode="link" onClick={backToChoose}>
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
            {searchQuery.isFetching ? (
              <Skeleton className="h-9 w-full" />
            ) : searchQuery.isError ? (
              // Distinct from the genuine-no-results copy below: a failed search (network
              // error, 5xx, or the per-user 60/min rate limit this debounced search
              // competes against) must never render as "no matches" — guardians have no
              // delete endpoint, so a user misled into "Create new" here creates a
              // permanent, unremovable duplicate record (round-7 review finding).
              <div className="space-y-2">
                <p className="text-sm text-destructive">{t("guardians.searchError")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void searchQuery.refetch();
                  }}
                >
                  {tCommon("retry")}
                </Button>
              </div>
            ) : searchQuery.isSuccess && searchResults.length === 0 ? (
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
              <form noValidate onSubmit={handleCreateSubmit} className="space-y-3">
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
