/**
 * Raises every rule configured as "warn" (or 1) to "error", keeping its options.
 *
 * Why: warnings never failed CI (no --max-warnings 0), so `no-console`, `react-hooks/
 * exhaustive-deps`, Next's `no-img-element` and the jsx-a11y rules eslint-config-next sets to
 * "warn" were silently ignored. Existing violations are frozen instead in each workspace's
 * `eslint-suppressions.json` baseline (ADR-0014) — and ESLint's bulk suppressions only cover
 * rules at "error", so a zero-warning policy needs every kept rule at "error".
 *
 * Wrap a workspace's whole flat-config array: `export default warningsAsErrors(defineConfig([...]))`.
 */
const raise = (value) => {
  if (value === "warn" || value === 1) return "error";
  if (Array.isArray(value) && (value[0] === "warn" || value[0] === 1))
    return ["error", ...value.slice(1)];
  return value;
};

export default function warningsAsErrors(configs) {
  return configs.map((config) =>
    config && typeof config === "object" && config.rules
      ? {
          ...config,
          rules: Object.fromEntries(
            Object.entries(config.rules).map(([rule, value]) => [rule, raise(value)]),
          ),
        }
      : config,
  );
}
