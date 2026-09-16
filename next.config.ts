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
  // Nessun blocco `images`: l'Image Optimizer resta senza host remoti
  // autorizzati, cioe' chiuso a tutto cio' che non e' locale.
  //
  // Qui c'era `remotePatterns` con `hostname: '**'` — qualsiasi dominio HTTPS.
  // Significava che chiunque poteva chiamare /_next/image?url=<qualunque cosa>
  // e far scaricare e ricomprimere al server un'immagine arbitraria presa da
  // internet: un proxy di immagini aperto, con l'amplificazione CPU che e' il
  // vettore della CVE "Next.js self-hosted applications vulnerable to DoS via
  // Image Optimizer" (npm audit, critica, 2026-09-16).
  //
  // Ed era configurazione morta: `next/image` compare in un solo punto del
  // progetto, il logo di components/Navbar.tsx, che e' /images/logo.svg — un
  // file locale, che non passa da remotePatterns. Le immagini degli eventi
  // usano <img src={event.imageUrl}> in components/EventCard.tsx e l'Image
  // Optimizer non le tocca.
  //
  // Se un giorno servisse ottimizzare un'immagine remota: si elencano gli
  // hostname davvero necessari, uno per uno. Mai '**'.
};

export default nextConfig;
