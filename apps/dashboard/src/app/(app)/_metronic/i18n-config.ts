"use client";

import { useState } from "react";

// Metronic's own real sample language list (from its i18n/config.ts), kept
// verbatim. useLanguage() itself is a local stub — the real vendor provider
// wires react-i18next/i18next-browser-languagedetector, which is genuine i18n
// machinery out of scope for this dev-only preview. This only drives which
// entry the language dropdown highlights.
export interface Language {
  code: string;
  name: string;
  shortName: string;
  direction: "ltr" | "rtl";
  flag: string;
}

export const I18N_LANGUAGES: [Language, ...Language[]] = [
  {
    code: "en",
    name: "English",
    shortName: "EN",
    direction: "ltr",
    flag: "/media/flags/united-states.svg",
  },
  {
    code: "ar",
    name: "Arabic",
    shortName: "AR",
    direction: "rtl",
    flag: "/media/flags/saudi-arabia.svg",
  },
  {
    code: "es",
    name: "Spanish",
    shortName: "ES",
    direction: "ltr",
    flag: "/media/flags/spain.svg",
  },
  {
    code: "de",
    name: "German",
    shortName: "DE",
    direction: "ltr",
    flag: "/media/flags/germany.svg",
  },
  {
    code: "ch",
    name: "Chinese",
    shortName: "CH",
    direction: "ltr",
    flag: "/media/flags/china.svg",
  },
];

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(I18N_LANGUAGES[0]);
  return { language, setLanguage, languages: I18N_LANGUAGES };
}
