import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bozze HTML/JS dei sketch GSD, gitignored: non e' codice dell'app.
    ".planning/**",
  ]),
  {
    rules: {
      // <img> e non next/image, di proposito: le immagini degli eventi
      // arrivano da decine di siti comunali, e next/image vorrebbe
      // l'Image Optimizer con remotePatterns aperti a quei domini — la
      // superficie della CVE critica chiusa con Next 16.4.1. Vedi il
      // commento in next.config.ts.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
