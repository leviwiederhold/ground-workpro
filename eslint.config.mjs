import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  {
    ignores: [
      "next-env.d.ts",
      "app/page.tsx",
      ".next/**",
      "test-results/**",
      "playwright-report/**",
      // Native build artifacts and Node tooling scripts are not app source and
      // must not be linted (generated Capacitor bridges, helper CLIs).
      "ios/**",
      "android/**",
      "scripts/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
];

export default config;
