import { UNIVERSAL_LINK_PATHS } from '@/lib/api-contract'

// Il file che la CDN di Apple scarica per i link universali (API-05): dice quali percorsi di
// fuori-rotta.it si aprono nell'app. Va servito come JSON, senza estensione, senza firma e SENZA
// redirect. force-dynamic perche' team e bundle id sono variabili d'ambiente del container a runtime
// (letti qui dentro a ogni richiesta, mai congelati nell'immagine alla build).
export const dynamic = 'force-dynamic'

export function GET(): Response {
  const team = process.env.APPLE_TEAM_ID ?? ''
  const bundle = process.env.APPLE_APP_BUNDLE_ID ?? ''
  // Senza app configurata il file non esiste: mai "undefined.undefined" come appID (T-26-21).
  if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-Za-z0-9.-]+$/.test(bundle)) {
    return new Response(null, { status: 404 })
  }
  return Response.json({
    applinks: { details: [{ appIDs: [`${team}.${bundle}`], components: UNIVERSAL_LINK_PATHS.map((p) => ({ '/': p })) }] },
  })
}
