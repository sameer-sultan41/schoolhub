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
  ],
};

export default createJestConfig(config);
