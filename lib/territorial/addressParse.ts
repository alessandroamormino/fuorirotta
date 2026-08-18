/**
 * Estrazione del comune da `address` per le sorgenti "venue-first" (D-05,
 * gradino di pre-estrazione).
 *
 * Esiste perche' una sorgente reale (`in-lombardia`, 59% degli eventi
 * locali) pubblica il nome della sede — piazza, teatro, centro storico — in
 * `location_name` e il comune dentro `address`, in un formato non uniforme
 * (`"via X, NN, CAP, Comune, SIGLA"`, `"Comune, CAP"`, `"Via ... - Comune"`,
 * o nessun comune estraibile del tutto). Senza questo passaggio il report
 * dei non risolti (D-06) misurerebbe la cosa sbagliata: sembrerebbe che la
 * cascata non trovi il comune, mentre starebbe cercando nel campo sbagliato.
 *
 * Nessun import di Prisma: funzione pura, riceve una stringa e restituisce
 * una lista di candidati che il chiamante prova uno per uno nella cascata
 * D-05 gia' esistente — questo modulo non sostituisce la cascata, la
 * alimenta con l'input giusto.
 *
 * Meccanica deliberatamente semplice: split su delimitatori fissi (virgola,
 * trattino, parentesi), non un'unica regex a quantificatori annidati.
 * L'input arriva da scraping di siti esterni (non fidato): una regex con
 * backtracking su pattern annidati e' un vettore ReDoS su una stringa lunga
 * senza delimitatori (T-06-06).
 */
import { normalizeComuneName } from './normalize'

const MAX_ADDRESS_LENGTH = 500 // stesso limite di prisma/schema.prisma (address VarChar(500))

// Parole di viabilita': un token che inizia con una di queste e' il nome di
// una sede (via, piazza, localita'...), non un comune. Confrontate sulla
// forma normalizzata (minuscole, accenti rimossi) cosi' "località"/"Località"
// e "loc."/"Loc." combaciano con la stessa voce.
const VIABILITY_WORDS = new Set([
  'via',
  'viale',
  'piazza',
  'piazzale',
  'corso',
  'largo',
  'localita',
  'loc',
  'strada',
  'vicolo',
  'contrada',
])

const DIGITS_ONLY = /^\d+$/ // CAP o numero civico
const PROVINCE_SIGLA = /^[A-Z]{2}$/ // sigla provincia, es. "CO", "LC"
const DELIMITERS = /[,\-()]/ // virgola, trattino, parentesi tonde — split fisso, nessun quantificatore

type TokenKind = 'empty' | 'digits' | 'sigla' | 'viability' | 'candidate'

function classify(token: string): TokenKind {
  if (!token) return 'empty'
  if (DIGITS_ONLY.test(token)) return 'digits'
  if (PROVINCE_SIGLA.test(token)) return 'sigla'
  const firstWord = normalizeComuneName(token.split(/\s+/)[0] ?? '')
  if (VIABILITY_WORDS.has(firstWord)) return 'viability'
  return 'candidate'
}

export function extractComuneCandidates(address: string | null): string[] {
  if (!address) return []

  const truncated = address.slice(0, MAX_ADDRESS_LENGTH)
  const rawTokens = truncated.split(DELIMITERS).map(t => t.trim())

  const priority: string[] = []
  const others: string[] = []

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    if (classify(token) !== 'candidate') continue

    // Il token subito dopo (saltando i token vuoti) e', nelle forme osservate,
    // quasi sempre una sigla provincia o un CAP quando il token corrente e'
    // il comune: promuovilo in cima alla lista.
    let next = ''
    for (let j = i + 1; j < rawTokens.length; j++) {
      if (rawTokens[j]) {
        next = rawTokens[j]
        break
      }
    }
    const nextKind = classify(next)
    const isPriority = next !== '' && (nextKind === 'digits' || nextKind === 'sigla')

    if (isPriority) priority.push(token)
    else others.push(token)
  }

  // I candidati non prioritari vanno in ordine di apparizione inversa: nelle
  // forme "via X - Comune" o "via X, ..., Comune, SIGLA" il comune tende a
  // comparire verso la fine della stringa.
  return [...priority, ...others.reverse()]
}

// Self-check: `npx tsx lib/territorial/addressParse.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente.
if (require.main === module) {
  // Forma 1: "via X, NN, comune (SIGLA)"
  const f1 = extractComuneCandidates('Via Municipio, 2, Magreglio (CO)')
  console.assert(f1.includes('Magreglio'), `atteso 'Magreglio' fra i candidati, ottenuto ${JSON.stringify(f1)}`)

  // Forma 2: "via X, NN, CAP, comune, SIGLA"
  const f2 = extractComuneCandidates('via Abbazia di Piona, 55, 23823, Colico, LC')
  console.assert(f2.includes('Colico'), `atteso 'Colico' fra i candidati, ottenuto ${JSON.stringify(f2)}`)

  // Forma 3: "comune, CAP"
  const f3 = extractComuneCandidates('Colico, 23823')
  console.assert(f3.includes('Colico'), `atteso 'Colico' fra i candidati, ottenuto ${JSON.stringify(f3)}`)

  // Forma 4: "via X - comune" (trattino)
  const f4 = extractComuneCandidates('Via Roma - Sondrio')
  console.assert(f4.includes('Sondrio'), `atteso 'Sondrio' fra i candidati, ottenuto ${JSON.stringify(f4)}`)

  // Nessun comune estraibile: solo via/piazza, fallimento reale della sorgente.
  const noCandidate = extractComuneCandidates('Piazza Libertà 27')
  console.assert(
    noCandidate.length === 0,
    `atteso nessun candidato plausibile per 'Piazza Libertà 27', ottenuto ${JSON.stringify(noCandidate)}`
  )

  // null/stringa vuota -> [], nessun lancio
  console.assert(
    Array.isArray(extractComuneCandidates(null)) && extractComuneCandidates(null).length === 0,
    'extractComuneCandidates(null) deve restituire []'
  )
  console.assert(
    Array.isArray(extractComuneCandidates('')) && extractComuneCandidates('').length === 0,
    "extractComuneCandidates('') deve restituire []"
  )

  // Token puramente numerici (CAP, civici) e sigle provincia non sono candidati.
  const onlyNoise = extractComuneCandidates('12, MI, 20100')
  console.assert(
    onlyNoise.length === 0,
    `CAP/civici/sigle non devono comparire come candidati, ottenuto ${JSON.stringify(onlyNoise)}`
  )

  // Stringa lunga (500 char, limite dello schema) senza delimitatori: nessun
  // backtracking, tempo lineare.
  const longNoDelimiter = 'a'.repeat(500)
  const start = Date.now()
  const longResult = extractComuneCandidates(longNoDelimiter)
  const elapsedMs = Date.now() - start
  console.assert(Array.isArray(longResult), 'stringa lunga senza delimitatori non deve lanciare')
  console.assert(elapsedMs < 500, `atteso tempo lineare (<500ms), ottenuto ${elapsedMs}ms`)

  // Stringa oltre il limite dello schema viene troncata, non causa un lancio.
  const overLong = extractComuneCandidates('Via Roma - Sondrio' + ','.repeat(1000) + 'Como')
  console.assert(Array.isArray(overLong), 'stringa oltre 500 caratteri non deve lanciare')

  console.log('[addressParse.ts] self-check OK')
}
