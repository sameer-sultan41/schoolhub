"use client";

import { useMemo, useState, type SyntheticEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm, useWatch, type FieldErrors, type Path } from "react-hook-form";
import { toast } from "sonner";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services, type SectionType, type WebsitePageDetail } from "@/services";
import { WEBSITE_PAGE_DETAIL_RESOURCE } from "@/services/modules/website/website-pages/website-pages-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { reasonText, withReasonText } from "@/features/website/shared/reason-message";
import { useSchemaMessages } from "@/features/website/shared/schema-fields";
import { useUploadTracker } from "@/features/website/shared/upload-tracker";
import {
  mapSectionErrors,
  newSection,
  sectionIndexesWithErrors,
  sectionsResolver,
  toSectionsFormValues,
  toSectionsPayload,
  type SectionFormValue,
  type SectionsFormValues,
} from "./sections-model";
import type { SectionTypes } from "./use-active-theme";

/**
 * The page editor's state: every section in one form, the selected one, the save
 * (`PATCH …/page-sections`) and where its errors go. A 422 lands under the input it names, else
 * on its section (flagged in the list, the first such section selected), else as the page's
 * own alert, so no refusal is ever silent. While an upload or a save is running the list's
 * structure is held (`isLocked`), so an upload's field path can't move under it.
 */
export function useSectionsForm(page: WebsitePageDetail, types: SectionTypes) {
  const t = useTranslations("website.pages.editor");
  const tReasons = useTranslations("website.reasons");
  const tErrors = useTranslations("errors");
  const messages = useSchemaMessages();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const queryClient = useQueryClient();
  const tracker = useUploadTracker();
  const submitGuard = useSubmitGuard();

  const resolver = useMemo(() => sectionsResolver(types, messages), [types, messages]);
  const form = useForm<SectionsFormValues>({
    resolver,
    defaultValues: toSectionsFormValues(page.sections, types),
  });
  const { append, move, remove } = useFieldArray({
    control: form.control,
    name: "sections",
  });
  const sections = useWatch({ control: form.control, name: "sections" });

  const [selectedKey, setSelectedKey] = useState<string | null>(page.sections[0]?.id ?? null);
  const [sectionMessages, setSectionMessages] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (values: SectionsFormValues) =>
      Services.websitePages.replacePageSections(page.id, toSectionsPayload(values, types)),
  });

  const selectedIndex = sections.findIndex((section) => section.key === selectedKey);
  const isLocked = tracker.isUploading || mutation.isPending;
  // A live page must keep a visible section; the API refuses a save without one.
  const needsVisibleSection =
    page.status === "published" && !sections.some((section) => section.is_visible);
  // Read here so the editor re-renders as they change (react-hook-form's proxy subscription).
  const { errors, isDirty } = form.formState;
  const errorKeys = new Set([
    ...sectionIndexesWithErrors(errors).flatMap((index) => sections[index]?.key ?? []),
    ...Object.keys(sectionMessages),
  ]);

  /** Selects the first of `indexes` in `list`, so the viewer lands on what needs fixing. */
  function selectFirst(list: readonly SectionFormValue[], indexes: number[]) {
    const key = list[Math.min(...indexes)]?.key;
    if (key !== undefined) setSelectedKey(key);
  }

  function showErrors(error: unknown, values: SectionsFormValues) {
    if (!(error instanceof ApiError)) {
      setFormError(t("saveFailed"));
      return;
    }
    const mapping = mapSectionErrors(error, values, types, (issue) => reasonText(issue, tReasons));
    for (const { path, message } of mapping.fields) {
      form.setError(path as Path<SectionsFormValues>, { type: "server", message });
    }
    setSectionMessages(mapping.sections);
    const flagged = values.sections.flatMap((section, index) =>
      mapping.sections[section.key] !== undefined ||
      mapping.fields.some((field) => field.path.startsWith(`sections.${index}.`))
        ? [index]
        : [],
    );
    if (flagged.length > 0) selectFirst(values.sections, flagged);
    if (mapping.page.length > 0) setFormError(mapping.page.join(" "));
    else if (flagged.length > 0) setFormError(t("fixSections"));
    else
      setFormError(resolveErrorMessage(withReasonText(error, tReasons), tErrors, t("saveFailed")));
  }

  async function save(values: SectionsFormValues) {
    try {
      const saved = await mutation.mutateAsync(values);
      const keepIndex = Math.max(
        0,
        values.sections.findIndex((s) => s.key === selectedKey),
      );
      form.reset(toSectionsFormValues(saved, types));
      setSelectedKey(saved[keepIndex]?.id ?? saved[0]?.id ?? null);
      // The header reads the saved sections (Publish needs a visible one): give it these now,
      // rather than after the refetch the invalidation starts.
      queryClient.setQueryData<WebsitePageDetail>(
        queryKeys.detail(WEBSITE_QUERY_MODULE, WEBSITE_PAGE_DETAIL_RESOURCE, page.id),
        (current) => (current ? { ...current, sections: saved } : current),
      );
      invalidateWebsite();
      toast.success(t("saved"));
    } catch (error) {
      showErrors(error, values);
    }
  }

  function onInvalid(errors: FieldErrors<SectionsFormValues>) {
    setFormError(t("fixSections"));
    const indexes = sectionIndexesWithErrors(errors);
    if (indexes.length > 0) selectFirst(form.getValues("sections"), indexes);
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    setFormError(null);
    setSectionMessages({});
    if (needsVisibleSection) {
      // Enter in a field gets past the held Save; the rule still holds.
      setFormError(t("liveNeedsVisible"));
      return;
    }
    void submitGuard.guard(async () => {
      // A submit that got past the held Save (Enter in a field) still waits for its uploads.
      await tracker.settled();
      await form.handleSubmit(save, onInvalid)();
    });
  }

  function discard() {
    form.reset();
    setSectionMessages({});
    setFormError(null);
    const saved = form.getValues("sections");
    if (!saved.some((section) => section.key === selectedKey)) {
      setSelectedKey(saved[0]?.key ?? null);
    }
  }

  /** Selects a section, unless an upload or save is running: leaving the edited section then
   * would unmount its image field and drop the upload's result. */
  function select(key: string) {
    if (isLocked && key !== selectedKey) return;
    setSelectedKey(key);
  }

  function add(type: SectionType) {
    const section = newSection(type, types);
    append(section);
    setSelectedKey(section.key);
  }

  function removeAt(index: number) {
    const key = sections[index]?.key;
    remove(index);
    if (key === selectedKey) {
      setSelectedKey(sections[index + 1]?.key ?? sections[index - 1]?.key ?? null);
    }
  }

  return {
    form,
    sections,
    tracker,
    selectedKey,
    selectedIndex,
    select,
    sectionMessages,
    errorKeys,
    formError,
    isDirty,
    isLocked,
    needsVisibleSection,
    isSaving: mutation.isPending,
    submit,
    discard,
    add,
    move,
    removeAt,
  };
}
