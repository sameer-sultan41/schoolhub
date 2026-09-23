"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { APP_SETTINGS, type Settings } from "@/app/(app)/_metronic/settings";

// Ported near-verbatim from Metronic's own providers/settings-provider.tsx —
// local per-viewer settings (sidebar collapse/theme), persisted to
// localStorage, exactly as Metronic's own Demo1 shell does it.
type Path = string;

type SettingsContextType = {
  getOption: (path: Path) => unknown;
  setOption: (path: Path, value: unknown) => void;
  storeOption: (path: Path, value: unknown) => void;
  settings: Settings;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const LOCAL_STORAGE_PREFIX = "metronic_demo1_preview_settings_";

const isBrowser = () => typeof window !== "undefined";

function getFromPath(obj: Settings, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function setToPath(obj: Settings, path: string, value: unknown): Settings {
  const keys = path.split(".");
  const lastKey = keys.pop();
  if (lastKey === undefined) return obj;

  let cursor = obj as unknown as Record<string, unknown>;
  for (const key of keys) {
    const next = cursor[key];
    if (next !== null && typeof next === "object") {
      cursor = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    }
  }
  cursor[lastKey] = value;
  return { ...obj };
}

function storeLeaf(path: string, value: unknown) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${path}`, JSON.stringify(value));
  } catch (err) {
    console.error("LocalStorage write error:", err);
  }
}

function getLeafFromStorage(path: string): unknown {
  if (!isBrowser()) return undefined;
  try {
    const item = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${path}`);
    return item ? JSON.parse(item) : undefined;
  } catch (err) {
    console.error("LocalStorage read error:", err);
    return undefined;
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(structuredClone(APP_SETTINGS));

  useEffect(() => {
    if (!isBrowser()) return;

    const init = structuredClone(APP_SETTINGS);
    Object.keys(localStorage)
      .filter((key) => key.startsWith(LOCAL_STORAGE_PREFIX))
      .forEach((key) => {
        const path = key.replace(LOCAL_STORAGE_PREFIX, "");
        const value = getLeafFromStorage(path);
        if (value !== undefined) {
          setToPath(init, path, value);
        }
      });
    // Hydrating from localStorage must happen post-mount (client-only);
    // reading during render would mismatch the server-rendered default and
    // break hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(init);
  }, []);

  const getOption = useCallback((path: string): unknown => getFromPath(settings, path), [settings]);

  const setOption = useCallback((path: string, value: unknown) => {
    setSettings((prev) => setToPath({ ...prev }, path, value));
  }, []);

  const storeOption = useCallback((path: string, value: unknown) => {
    setSettings((prev) => {
      const newSettings = setToPath({ ...prev }, path, value);
      storeLeaf(path, value);
      return newSettings;
    });
  }, []);

  const contextValue = useMemo(
    () => ({ getOption, setOption, storeOption, settings }),
    [getOption, setOption, storeOption, settings],
  );

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
