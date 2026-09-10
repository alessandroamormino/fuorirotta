/**
 * Finestra di pagine per la paginazione numerata desktop (D-6, VR-08).
 * Modulo puro, zero dipendenze: pageWindow/PAGE_WINDOW_SLOTS sono importati
 * anche da app/HomeClient.tsx ("use client") e finiscono nel bundle del
 * browser — nessun import da React, nessun accesso a DOM/rete/DB.
 */

// Primo + ellissi + tre centrali + ellissi + ultimo: la forma piu' stretta
// che tiene insieme "dove sono" e "dove posso andare" senza cambiare
// larghezza fra pagina 3 e pagina 97. Portante al call site
// (app/HomeClient.tsx la usa come tetto finale su .slice), non decorativa —
// una costante solo dichiarata sarebbe una variabile morta.
export const PAGE_WINDOW_SLOTS = 7;

export type PageSlot = number | "…";

/**
 * Restituisce al piu' PAGE_WINDOW_SLOTS caselle: prima, ultima, corrente, i
 * due vicini, il resto come ellissi. Stessa identica logica del mock
 * (.planning/sketches/004-desktop-redesign/desktop-eventi.html:395-411), con
 * in piu' la normalizzazione degli ingressi: `last` sotto 1 vale 1, `current`
 * viene riportato dentro [1, last] prima del calcolo — un ingresso fuori
 * scala non lancia e rispetta comunque le invarianti della finestra.
 *
 */
export function pageWindow(current: number, last: number): PageSlot[] {
  const lastPage = last < 1 ? 1 : last;
  const page = Math.min(Math.max(current, 1), lastPage);

  if (lastPage <= PAGE_WINDOW_SLOTS) {
    return Array.from({ length: lastPage }, (_, i) => i + 1);
  }

  let from = Math.max(2, page - 1);
  let to = Math.min(lastPage - 1, page + 1);
  if (page <= 3) {
    from = 2;
    to = 4;
  }
  if (page >= lastPage - 2) {
    from = lastPage - 3;
    to = lastPage - 1;
  }

  const out: PageSlot[] = [1];
  if (from > 2) out.push("…");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < lastPage - 1) out.push("…");
  out.push(lastPage);
  return out;
}

// Self-check: `npx tsx lib/pagination.ts`. Guardia a tre condizioni copiata
// da lib/eventStatus.ts:100 — non e' cerimonia. Questo modulo e' importato
// da app/HomeClient.tsx ("use client") e finisce nel bundle del browser, dove
// `module` non esiste: la forma senza guardia ha gia' ucciso la home in
// questa stessa fase, con tutti i controlli lato server verdi.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  let failures = 0;
  const assertCheck = (condition: boolean, message: string) => {
    console.assert(condition, message);
    if (!condition) failures++;
  };
  const numbersOf = (out: PageSlot[]) => out.filter((s): s is number => s !== "…");

  assertCheck(
    JSON.stringify(pageWindow(1, 1)) === JSON.stringify([1]),
    "pageWindow(1,1) deve restituire [1]"
  );
  assertCheck(
    JSON.stringify(pageWindow(4, 7)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
    "pageWindow(4,7) deve restituire tutte le 7 pagine senza ellissi"
  );
  assertCheck(
    JSON.stringify(pageWindow(1, 8)) === JSON.stringify([1, 2, 3, 4, "…", 8]),
    'pageWindow(1,8) deve restituire [1,2,3,4,"…",8]'
  );
  assertCheck(
    JSON.stringify(pageWindow(8, 8)) === JSON.stringify([1, "…", 5, 6, 7, 8]),
    'pageWindow(8,8) deve restituire [1,"…",5,6,7,8]'
  );
  const p165 = JSON.stringify([1, 2, 3, 4, "…", 165]);
  assertCheck(
    JSON.stringify(pageWindow(1, 165)) === p165,
    'pageWindow(1,165) deve restituire [1,2,3,4,"…",165]'
  );
  assertCheck(
    JSON.stringify(pageWindow(2, 165)) === p165,
    "pageWindow(2,165) deve restituire lo stesso di pageWindow(1,165)"
  );
  assertCheck(
    JSON.stringify(pageWindow(3, 165)) === p165,
    "pageWindow(3,165) deve restituire lo stesso di pageWindow(1,165)"
  );
  assertCheck(
    JSON.stringify(pageWindow(4, 165)) === JSON.stringify([1, "…", 3, 4, 5, "…", 165]),
    'pageWindow(4,165) deve restituire [1,"…",3,4,5,"…",165]'
  );
  assertCheck(
    JSON.stringify(pageWindow(50, 165)) === JSON.stringify([1, "…", 49, 50, 51, "…", 165]),
    'pageWindow(50,165) deve restituire [1,"…",49,50,51,"…",165]'
  );
  const pLast = JSON.stringify([1, "…", 162, 163, 164, 165]);
  assertCheck(
    JSON.stringify(pageWindow(164, 165)) === pLast,
    'pageWindow(164,165) deve restituire [1,"…",162,163,164,165]'
  );
  assertCheck(
    JSON.stringify(pageWindow(165, 165)) === pLast,
    "pageWindow(165,165) deve restituire lo stesso di pageWindow(164,165)"
  );

  // Invarianti a scala reale (1.971 eventi / 12 = 165 pagine): ogni current
  // da 1 a 165 rispetta finestra <= 7, primo/ultimo/corrente presenti,
  // nessun numero ripetuto.
  for (let current = 1; current <= 165; current++) {
    const slots = pageWindow(current, 165);
    assertCheck(
      slots.length <= PAGE_WINDOW_SLOTS,
      `pageWindow(${current},165): piu' di ${PAGE_WINDOW_SLOTS} caselle`
    );
    assertCheck(slots[0] === 1, `pageWindow(${current},165): non inizia con 1`);
    assertCheck(slots[slots.length - 1] === 165, `pageWindow(${current},165): non finisce con 165`);
    assertCheck(slots.includes(current), `pageWindow(${current},165): non include la pagina corrente ${current}`);
    const numbers = numbersOf(slots);
    assertCheck(new Set(numbers).size === numbers.length, `pageWindow(${current},165): numero ripetuto`);
  }

  // Ingressi fuori scala: non lanciano, e la pagina viene riportata dentro
  // [1, last] prima del calcolo.
  assertCheck(JSON.stringify(pageWindow(0, 165)) === p165, "pageWindow(0,165) deve comportarsi come pageWindow(1,165)");
  assertCheck(JSON.stringify(pageWindow(-3, 165)) === p165, "pageWindow(-3,165) deve comportarsi come pageWindow(1,165)");
  assertCheck(
    JSON.stringify(pageWindow(999, 165)) === pLast,
    "pageWindow(999,165) deve comportarsi come pageWindow(165,165)"
  );

  // `last` sotto 1 vale 1: una lista vuota ha comunque una pagina.
  assertCheck(JSON.stringify(pageWindow(1, 0)) === JSON.stringify([1]), "pageWindow(1,0) deve restituire [1] (last<1 vale 1)");
  assertCheck(JSON.stringify(pageWindow(5, -2)) === JSON.stringify([1]), "pageWindow(5,-2) deve restituire [1] (last<1 vale 1)");

  if (failures > 0) {
    console.error(`[pagination.ts] self-check FALLITO: ${failures} asserzioni non superate`);
    process.exit(1);
  }
  console.log("[pagination.ts] self-check OK");
}
