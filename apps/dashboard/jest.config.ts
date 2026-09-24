import nextJest from "next/jest.js";
import type { Config } from "jest";

// `next/jest` wires up SWC (same transform as the build), CSS/image stubs, and .env loading.
const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "jsdom",
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/app/**/layout.tsx",
    "!src/**/*.d.ts",
    // Compile-time-only: never imported by anything (see its own docstring) —
    // importing it under Jest would trip the `declare const` it deliberately
    // leaves unassigned. tsc/ESLint still walk it via their own glob include.
    "!src/i18n/messages.types-check.ts",
    // The vendor Metronic demo1 shell, ported as-is: the layout frame and the topbar's
    // dummy-content widgets (fake notifications, chat, apps, search). What this app wires
    // to real data stays measured — shell/dashboard/*, the user menu, menu-config,
    // toolbar, data-grid-labels. `**` rather than `(app)`: the glob engine reads bare
    // parentheses as a regex group, so a literal `(app)` segment would never match.
    "!src/app/**/shell/{breadcrumb,content,footer,header,settings-provider,shell,sidebar,sidebar-header,sidebar-menu}.tsx",
    "!src/app/**/shell/{general-config,settings}.ts",
    "!src/app/**/shell/partials/common/**",
    "!src/app/**/shell/partials/topbar/{apps-dropdown-menu,chat-sheet,notification-item,notifications-sheet,search-dialog}.tsx",
    "!src/app/**/shell/partials/topbar/search/**",
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};

export default createJestConfig(config);
