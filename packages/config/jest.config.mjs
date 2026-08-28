/**
 * This package holds configuration only — the entry exists so `turbo run test` is uniform
 * across every workspace.
 *
 * @type {import('jest').Config}
 */
const config = {
  testEnvironment: "node",
  passWithNoTests: true,
};

export default config;
