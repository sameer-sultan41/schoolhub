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
