/**
 * Jest for a source-only TypeScript package: @swc/jest transpiles, no build step.
 * (The Next.js apps use `next/jest` instead — see each app's own jest.config.ts.)
 *
 * @type {import('jest').Config}
 */
const config = {
  testEnvironment: "node",
  clearMocks: true,
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.(t|j)sx?$": ["@swc/jest", { jsc: { target: "es2022" } }],
  },
  moduleNameMapper: {
    "^@schoolhub/types$": "<rootDir>/../types/src/index.ts",
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"],
};

export default config;
