// Ported from Metronic's own config/types.ts + config/settings.config.ts
// (Settings shape + APP_SETTINGS default), trimmed to the demo1 slice this
// preview actually reads.
export interface Settings {
  layout: string;
  layouts: {
    demo1: {
      sidebarCollapse: boolean;
      sidebarTheme: "light" | "dark";
    };
  };
}

export const APP_SETTINGS: Settings = {
  layout: "",
  layouts: {
    demo1: {
      sidebarCollapse: false,
      sidebarTheme: "light",
    },
  },
};
