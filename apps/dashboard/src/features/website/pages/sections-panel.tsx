"use client";

import { useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
  Form,
} from "@schoolhub/ui";

import { isSectionType } from "@/services/modules/website/website-pages/website-pages-constant";
import { UploadTrackerProvider } from "@/features/website/shared/upload-tracker";
import { AddSectionMenu } from "./add-section-menu";
import { SectionEditor } from "./section-editor";
import { SectionList } from "./section-list";
import type { SectionTypes } from "./use-active-theme";
import type { useSectionsForm } from "./use-sections-form";

export interface SectionsPanelProps {
  editor: ReturnType<typeof useSectionsForm>;
  types: SectionTypes;
  labelOf: (type: string) => string;
  /** Why the viewer can't change the sections (shown above them), or `null` when they can. */
  readOnlyNotice: string | null;
  /** The page is live and the viewer may edit it: a save changes the public site. */
  isLive: boolean;
}

/** The page's sections: the ordered list with "Add section" beside the selected section's
 * editor, and Save / Discard under both. Save is held while an upload runs, and on a live page
 * while no section is visible (the API refuses that, `no_visible_sections`). */
export function SectionsPanel({
  editor,
  types,
  labelOf,
  readOnlyNotice,
  isLive,
}: SectionsPanelProps) {
  const t = useTranslations("website.pages.editor");
  const { form, sections, selectedIndex, selectedKey } = editor;
  const selected = sections[selectedIndex];
  const offered = Object.keys(types).filter(isSectionType);
  const readOnly = readOnlyNotice !== null;

  return (
    <UploadTrackerProvider value={editor.tracker}>
      <Form {...form}>
        <form noValidate onSubmit={editor.submit} className="space-y-4">
          {editor.formError ? (
            <Alert variant="destructive">
              <AlertDescription>{editor.formError}</AlertDescription>
            </Alert>
          ) : null}
          {readOnlyNotice ? (
            <Alert variant="info">
              <AlertDescription>{readOnlyNotice}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>{t("sectionsHeading")}</CardTitle>
                </CardHeading>
                {readOnly ? null : (
                  <CardToolbar>
                    <AddSectionMenu
                      types={offered}
                      labelOf={labelOf}
                      count={sections.length}
                      disabled={editor.isLocked}
                      onAdd={editor.add}
                    />
                  </CardToolbar>
                )}
              </CardHeader>
              <CardContent>
                <SectionList
                  sections={sections}
                  selectedKey={selectedKey}
                  errorKeys={editor.errorKeys}
                  labelOf={labelOf}
                  locked={editor.isLocked}
                  readOnly={readOnly}
                  onSelect={editor.select}
                  onMove={editor.move}
                  onRemove={editor.removeAt}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                {selected ? (
                  <SectionEditor
                    // Keyed by position too: a move renames every nested field path, so the
                    // editor (and its field arrays) start over on the section's new path.
                    key={`${selected.key}:${selectedIndex}`}
                    form={form}
                    index={selectedIndex}
                    sectionKey={selected.key}
                    sectionType={selected.section_type}
                    types={types}
                    label={labelOf(selected.section_type)}
                    message={editor.sectionMessages[selected.key]}
                    readOnly={readOnly}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noSelection")}</p>
                )}
              </CardContent>
            </Card>
          </div>
          {readOnly ? null : (
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <div className="me-auto space-y-1 text-sm" aria-live="polite">
                {editor.needsVisibleSection ? (
                  <p className="text-destructive">{t("liveNeedsVisible")}</p>
                ) : null}
                {editor.isDirty ? <p className="text-muted-foreground">{t("unsaved")}</p> : null}
                {isLive ? <p className="text-muted-foreground">{t("liveHint")}</p> : null}
              </div>
              <Button
                variant="outline"
                disabled={!editor.isDirty || editor.isLocked}
                onClick={editor.discard}
              >
                {t("discard")}
              </Button>
              <Button
                type="submit"
                disabled={editor.isLocked || editor.needsVisibleSection}
                isLoading={editor.isSaving}
                loadingLabel={t("saving")}
              >
                {t("save")}
              </Button>
            </div>
          )}
        </form>
      </Form>
    </UploadTrackerProvider>
  );
}
