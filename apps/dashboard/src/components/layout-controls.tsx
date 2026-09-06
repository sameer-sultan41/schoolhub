"use client";

import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  THEME_PRESETS,
  ToggleGroup,
  ToggleGroupItem,
} from "@schoolhub/ui";
import { Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  CONTENT_LAYOUTS,
  NAVBAR_STYLES,
  SIDEBAR_COLLAPSE_MODES,
  SIDEBAR_VARIANTS,
  type PreferenceKey,
  type PreferenceValues,
} from "@/lib/preferences/preferences-config";
import { usePreference, usePreferenceActions } from "@/lib/preferences/preferences-provider";

/**
 * The colour preset picker.
 *
 * A Select rather than a segmented group: five options with real names do not fit a row
 * of equal segments, and the names are the point — "School colours" has to be readable
 * for a viewer to understand what choosing anything else costs them.
 *
 * Declared at module scope, not inside LayoutControls. A component defined in another
 * component's body is a new type on every render, so React unmounts and remounts it —
 * which would close this Select mid-interaction — and its hooks belong to a component
 * the rules of hooks cannot see.
 */
function PresetField() {
  const t = useTranslations("nav.preferences");
  const value = usePreference("theme_preset");
  const { setPreference } = usePreferenceActions();
  const fieldId = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className="text-xs">
        {t("preset.label")}
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          setPreference("theme_preset", next as PreferenceValues["theme_preset"]);
        }}
      >
        <SelectTrigger id={fieldId} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {t(`preset.${preset}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * One preference as a segmented control.
 *
 * Labelled by a plain span, not a <label>: a ToggleGroup is a radiogroup, not a form
 * control a label can be `for`, and a label pointing at nothing is a lie to a screen
 * reader. aria-labelledby is the relationship that actually holds.
 *
 * Radix reports "" when the pressed item is pressed again. That is a deselect, not a
 * choice, so it is ignored — there is no "no sidebar variant" state to fall into.
 */
function SegmentedField<K extends PreferenceKey>({
  preferenceKey,
  label,
  options,
  optionLabel,
}: {
  preferenceKey: K;
  label: string;
  options: readonly PreferenceValues[K][];
  optionLabel: (value: PreferenceValues[K]) => string;
}) {
  const value = usePreference(preferenceKey);
  const { setPreference } = usePreferenceActions();
  const labelId = useId();

  return (
    <div className="space-y-1.5">
      <span id={labelId} className="block text-xs font-medium text-foreground">
        {label}
      </span>
      <ToggleGroup
        type="single"
        value={value}
        aria-labelledby={labelId}
        onValueChange={(next) => {
          if (!next) return;
          setPreference(preferenceKey, next as PreferenceValues[K]);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option} value={option} size="sm" className="flex-1">
            {optionLabel(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * How this dashboard is laid out, in one popover.
 *
 * Every control writes straight through to the store, which applies the `<html>`
 * attribute and the cookie together — there is no Save. A layout choice is reversible and
 * its result is visible behind the popover as you make it, so a confirm step would only
 * be a step.
 */
export function LayoutControls() {
  const t = useTranslations("nav.preferences");
  const { resetPreferences } = usePreferenceActions();
  const descriptionId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("trigger")}>
          <Settings2 aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent label={t("title")} aria-describedby={descriptionId} className="w-80">
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="font-heading text-sm font-semibold text-foreground">{t("title")}</p>
            <p id={descriptionId} className="text-xs text-muted-foreground">
              {t("description")}
            </p>
          </div>

          <PresetField />

          <SegmentedField
            preferenceKey="sidebar_variant"
            label={t("sidebarVariant.label")}
            options={SIDEBAR_VARIANTS}
            optionLabel={(value) => t(`sidebarVariant.${value}`)}
          />

          <SegmentedField
            preferenceKey="sidebar_collapsible"
            label={t("sidebarCollapse.label")}
            options={SIDEBAR_COLLAPSE_MODES}
            optionLabel={(value) => t(`sidebarCollapse.${value}`)}
          />

          <SegmentedField
            preferenceKey="content_layout"
            label={t("contentLayout.label")}
            options={CONTENT_LAYOUTS}
            optionLabel={(value) => t(`contentLayout.${value}`)}
          />

          <SegmentedField
            preferenceKey="navbar_style"
            label={t("navbarStyle.label")}
            options={NAVBAR_STYLES}
            optionLabel={(value) => t(`navbarStyle.${value}`)}
          />

          <Button variant="outline" size="sm" block onClick={resetPreferences}>
            {t("reset")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
