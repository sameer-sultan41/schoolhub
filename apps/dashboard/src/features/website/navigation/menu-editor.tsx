"use client";

import { useMemo } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Alert, Button, Form } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import {
  Services,
  type NavigationMenuRecord,
  type NavigationTargetType,
  type WebsitePageRecord,
} from "@/services";
import {
  NAV_MAX_ITEMS,
  NAV_PAGE_TARGET,
  NAV_URL_TARGET,
} from "@/services/modules/website/navigation-menus/navigation-menus-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";
import { MenuItemEditor } from "./menu-item-editor";
import {
  canNest,
  countLinks,
  localiseMenuError,
  menuFields,
  menuFormSchema,
  nestItem,
  toMenuFormValues,
  toNavItems,
  unnestItem,
  type MenuFormValues,
  type MenuMessages,
} from "./navigation-model";
import { useMenuDnd } from "./use-menu-dnd";
import { navigationMenusKey } from "./use-navigation-menus";

/** The `website.reasons` scope of the menu's refusals. */
const NAVIGATION_REASON_SCOPE = "navigation";

/** Which `invalid_target` sentence a link's type gets: the server's reason covers all three. */
function invalidTargetKey(type: NavigationTargetType | undefined): string {
  if (type === NAV_PAGE_TARGET) return "page";
  if (type === NAV_URL_TARGET) return "url";
  return "other";
}

export interface MenuEditorProps {
  menu: NavigationMenuRecord;
  pages: readonly WebsitePageRecord[];
  /** `website.navigation.update`: without it the menu is read-only. */
  canUpdate: boolean;
}

/**
 * One location's menu as a two-level tree, saved whole (`PATCH /navigation-menus/{location}`).
 * The editor holds the server's rules it can: at most `NAV_MAX_ITEMS` links (Add stops there),
 * two levels (nesting a link that has sub-links is refused), a label of 1 to 60 characters, a
 * published page or a safe link. Anything the server still refuses lands under the link it names
 * (`items.2.children.0.target`) or, for the menu as a whole, as the form's message.
 */
export function MenuEditor({ menu, pages, canUpdate }: MenuEditorProps) {
  const t = useTranslations("website.navigation");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const tSchema = useTranslations("website.schemaFields.errors");
  const queryClient = useQueryClient();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const messages = useMemo<MenuMessages>(
    () => ({
      required: tCommon("requiredField"),
      tooLong: (max) => tSchema("tooLong", { max }),
      unsafeUrl: tSchema("unsafeUrl"),
      choosePage: t("choosePage"),
    }),
    [t, tCommon, tSchema],
  );
  const schema = useMemo(() => menuFormSchema(messages), [messages]);
  const form = useForm<MenuFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toMenuFormValues(menu.items),
  });
  const { fields, append, move, remove, replace } = useFieldArray({
    control: form.control,
    name: "items",
  });
  const items = useWatch({ control: form.control, name: "items" });
  const ids = fields.map((field) => field.id);
  const dnd = useMenuDnd(ids, move);
  const full = countLinks(items) >= NAV_MAX_ITEMS;

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: MenuFormValues) => {
      try {
        return await Services.navigationMenus.updateNavigationMenu(
          menu.location,
          toNavItems(values),
        );
      } catch (failure) {
        const localised = localiseMenuError(failure, values, (reason, type) => {
          const key =
            reason === "invalid_target"
              ? `${NAVIGATION_REASON_SCOPE}.invalid_target.${invalidTargetKey(type)}`
              : `${NAVIGATION_REASON_SCOPE}.${reason}`;
          return tReasons.has(key) ? tReasons(key) : undefined;
        });
        throw withReasonText(localised, tReasons);
      }
    },
    knownFields: () => menuFields(form.getValues()),
    onSuccess: (saved) => {
      queryClient.setQueryData<NavigationMenuRecord[]>(navigationMenusKey(), (menus) =>
        menus?.map((entry) => (entry.location === saved.location ? saved : entry)),
      );
      invalidateWebsite();
      form.reset(toMenuFormValues(saved.items));
      toast.success(t("saved"));
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {formError && <Alert variant="destructive">{formError}</Alert>}
        <fieldset disabled={!canUpdate} className="space-y-4">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <DndContext
              sensors={dnd.sensors}
              collisionDetection={closestCenter}
              accessibility={dnd.accessibility}
              onDragEnd={dnd.onDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ol className="space-y-3" aria-label={t("listLabel")}>
                  {fields.map((field, index) => (
                    <MenuItemEditor
                      key={field.id}
                      form={form}
                      id={field.id}
                      index={index}
                      count={fields.length}
                      pages={pages}
                      nestable={canNest(items, index)}
                      full={full}
                      onMove={move}
                      onRemove={remove}
                      onNest={(at) => {
                        replace(nestItem(form.getValues("items"), at));
                      }}
                      onUnnest={(parent, child) => {
                        replace(unnestItem(form.getValues("items"), parent, child));
                      }}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
          {canUpdate ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={full}
                onClick={() => {
                  append({ label: "", target_type: NAV_PAGE_TARGET, target: "", children: [] });
                }}
              >
                <Plus aria-hidden="true" />
                {t("addItem")}
              </Button>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {full ? t("full", { max: NAV_MAX_ITEMS }) : t("limits", { max: NAV_MAX_ITEMS })}
              </p>
            </div>
          ) : null}
        </fieldset>
        {canUpdate ? (
          <div className="flex justify-end">
            <Button type="submit" isLoading={isPending} loadingLabel={tCommon("saving")}>
              {t("save")}
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
  );
}
