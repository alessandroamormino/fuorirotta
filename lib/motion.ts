// Vocabolario di movimento per framer-motion (D-16, criterio di successo 8).
// framer-motion vuole numeri JavaScript e non sa leggere una custom property
// CSS: queste costanti sono il gemello TypeScript dei tre token dichiarati in
// app/globals.css (:root e .dark). Cambiarne uno senza l'altro e' la deriva
// che scripts/visual-restyle.test.sh (VR-07) intercetta confrontando le due
// forme — non modificare un valore qui senza aggiornare anche globals.css.
//
// E' l'unico file TypeScript del repository che dichiara una durata di
// animazione come numero letterale.
//
// Le molle (smorzamento/rigidita' del morph desktop e del foglio mobile)
// restano fuori da questo vocabolario: non hanno una durata, e i loro
// parametri sono gia' stati misurati a schermo caso per caso.

/** Gemello di --motion-fast (150ms) in app/globals.css. */
export const MOTION_FAST = 0.15;

/** Gemello di --motion-base (220ms) in app/globals.css. */
export const MOTION_BASE = 0.22;

/** Gemello di --ease-standard (cubic-bezier(0.28, 0, 0.22, 1)) in app/globals.css. */
export const EASE_STANDARD: [number, number, number, number] = [0.28, 0, 0.22, 1];
