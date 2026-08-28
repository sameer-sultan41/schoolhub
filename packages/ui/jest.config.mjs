/**
 * Jest for the shared component package. @swc/jest transpiles TSX with the automatic
 * React runtime; the Next.js apps use `next/jest` instead.
 *
 * @type {import('jest').Config}
 */
const config = {
  testEnvironment: "jsdom",
  clearMocks: true,
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2022",
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@schoolhub/types$": "<rootDir>/../types/src/index.ts",
    "\\.css$": "<rootDir>/src/__mocks__/style.ts",
  },
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/index.ts"],
};

export default config;
