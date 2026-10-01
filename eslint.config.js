import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // TypeScript parsing for `<script lang="ts">` + runes awareness via svelte.config.js.
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // svelte-check owns Svelte compiler + a11y diagnostics — don't duplicate them in ESLint.
      "svelte/valid-compile": "off",
      // Every Map/Set here is a local temporary inside a plain function (removeBone's `removed`,
      // sortBonesByHierarchy's `placed`, applyRig's name sets, advancePoseSim's `posed`) — built
      // and discarded within one call, never read reactively. SvelteMap/SvelteSet would only add
      // signal overhead.
      "svelte/prefer-svelte-reactivity": "off",
    },
  },
  {
    // Core prefer-const mis-fires on runes destructures (`let { x } = $props()`, `let x = $state()`
    // legitimately need `let`); use the runes-aware svelte/prefer-const instead.
    files: ["**/*.svelte"],
    rules: { "prefer-const": "off", "svelte/prefer-const": "warn" },
  },
  // Disable rules that conflict with Prettier (must be after the rule configs).
  prettier,
  ...svelte.configs.prettier,
  {
    // Tailwind class-level lint. ONLY the conflict/duplicate rules: they catch real bugs (e.g.
    // `relative sticky` — two classes fighting over `position`). Deliberately NOT enabling
    // class-ORDER (prettier-plugin-tailwindcss already sorts) or `no-unregistered-classes` (this
    // codebase has legitimate custom classes like `paper-checker` and `selection-actions-panel`
    // that it would flag as unknown). Tailwind 4 is CSS-first, so the plugin needs the entry
    // stylesheet to resolve the theme.
    files: ["**/*.svelte", "**/*.html"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: {
      "better-tailwindcss": { entryPoint: "src/app.css" },
    },
    rules: {
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "warn",
      "better-tailwindcss/enforce-canonical-classes": "warn",
      // canonical-classes leaves double spaces behind when it collapses pairs — this tidies them.
      "better-tailwindcss/no-unnecessary-whitespace": "warn",
    },
  },
  {
    // The icon generator is a build-time Node script — Node globals (Buffer), not browser ones.
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    ignores: ["dist/"],
  },
);
