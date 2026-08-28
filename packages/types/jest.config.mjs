/**
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
};

export default config;
