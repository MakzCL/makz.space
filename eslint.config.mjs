import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/** Flat config. Next 16 ships its shareable configs as flat arrays. */
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "supabase/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Unused values are a smell in a build this size; flag them, allowing
      // the conventional leading underscore for deliberate placeholders.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
