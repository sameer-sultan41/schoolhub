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
  canUpdate: boolean;
}

/** The page's sections: the ordered list with "Add section" beside the selected section's
 * editor, and Save / Discard under both. Save is held while an upload runs. */
export function SectionsPanel({ editor, types, labelOf, canUpdate }: SectionsPanelProps) {
  const t = useTranslations("website.pages.editor");
  const { form, sections, selectedIndex, selectedKey } = editor;
  const selected = sections[selectedIndex];
  const offered = Object.keys(types).filter(isSectionType);
  const readOnly = !canUpdate;

  return (
    <UploadTrackerProvider value={editor.tracker}>
      <Form {...form}>
        <form noValidate onSubmit={editor.submit} className="space-y-4">
          {editor.formError ? (
            <Alert variant="destructive">
              <AlertDescription>{editor.formError}</AlertDescription>
            </Alert>
          ) : null}
          {readOnly ? (
            <Alert variant="info">
              <AlertDescription>{t("readOnly")}</AlertDescription>
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
                    key={selected.key}
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
              {editor.isDirty ? (
                <p className="me-auto text-sm text-muted-foreground" aria-live="polite">
                  {t("unsaved")}
                </p>
              ) : null}
              <Button
                variant="outline"
                disabled={!editor.isDirty || editor.isLocked}
                onClick={editor.discard}
              >
                {t("discard")}
              </Button>
              <Button
                type="submit"
                disabled={editor.isLocked}
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
