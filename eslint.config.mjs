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
      // Il client Prisma 7 generato e' solo per Node: un import di VALORE da
      // un file che finisce nel bundle del browser lo trascina li' e la home
      // esplode al caricamento ("i is undefined", 2026-10-16, da lib/types.ts).
      // I tipi si importano ovunque con `import type`; i valori solo da
      // lib/prisma.ts, qui sotto.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/generated/prisma/*"],
              allowTypeImports: true,
              message: "Solo `import type` dal client generato; i valori passano da lib/prisma.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/prisma.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
