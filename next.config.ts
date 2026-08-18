import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Il lock di sviluppo di Next 16 (.next/dev/lock) e' per-distDir, non per-porta:
  // un secondo `next dev` sulla stessa directory di progetto rifiuta di partire
  // anche su una porta diversa se un'altra istanza e' gia' attiva (es. npm run
  // dev:local su :3000). scripts/comuni-search.test.sh, che deve avviare un
  // server effimero senza toccare quello eventualmente gia' in esecuzione,
  // imposta questa variabile per usare un distDir separato; senza di essa il
  // comportamento e' quello di sempre (.next).
  ...(process.env.NEXT_TEST_DIST_DIR ? { distDir: process.env.NEXT_TEST_DIST_DIR } : {}),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.solosagre.it',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
