import base from "../../prettier.config.mjs";

/**
 * Extends the root config with Tailwind v4 class sorting. Tailwind v4 is CSS-first (no
 * tailwind.config.js), so the plugin needs this app's own CSS entry point — there is no
 * shared stylesheet to point at from the root config, which is why this file exists
 * per-app rather than once.
 *
 * prettier-plugin-tailwindcss must be the LAST plugin when combined with others
 * (https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins).
 */
export default {
  ...base,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/app/globals.css",
};
