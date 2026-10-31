// Contratto dell'API per l'app (check:mobile-contract, test:ci). Nessun database.
//
// Per ora prova che il comparatore di scripts/golden-shape.ts sa FALLIRE: senza
// questa prova il gate check:api-golden (che gira solo in locale, sul Postgres di
// sviluppo) potrebbe essere vuoto e nessuno se ne accorgerebbe in CI. Il piano 05
// della Fase 26 appende qui i casi sulla configurazione e su .well-known.
//
// Esce con 1 al primo controllo fallito. Stampa "ok  <caso>" per ognuno.
import { compareShapes, shapeOf } from './golden-shape'

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

const golden = shapeOf({ a: 'x', n: 1, list: [{ b: 'y' }], flag: true })
const violationsOf = (value: unknown) => compareShapes(golden, shapeOf(value))
const base = { a: 'x', n: 1, list: [{ b: 'y' }], flag: true }

check('forma identica -> nessuna violazione', violationsOf(base).length === 0)

const removed = violationsOf({ n: 1, list: [{ b: 'y' }], flag: true })
check('chiave rimossa -> percorso rimosso', removed.some((v) => v === 'percorso rimosso: $.a'), removed.join('; '))

const retyped = violationsOf({ ...base, a: 5 })
check('stringa -> numero -> tipo perso', retyped.includes('tipo perso: $.a (string)'), retyped.join('; '))

const lost = violationsOf({ ...base, list: ['solo-stringhe'] })
check(
  "elementi oggetto -> stringhe: violazione sul percorso dell'elemento",
  lost.includes('tipo perso: $.list[] (object)') && lost.includes('percorso rimosso: $.list[].b'),
  lost.join('; '),
)

const emptied = violationsOf({ ...base, list: [] })
check('array svuotato -> percorso rimosso (la risposta vuota non passa)', emptied.includes('percorso rimosso: $.list[]'), emptied.join('; '))

check('chiave aggiunta -> compatibile', violationsOf({ ...base, extra: [1, 2] }).length === 0)
check(
  'tipo aggiunto (null accanto a string) -> compatibile',
  compareShapes({ '$.x': ['string'] }, { '$.x': ['null', 'string'] }).length === 0,
)
check('valore che diventa SOLO null -> tipo perso', violationsOf({ ...base, a: null }).includes('tipo perso: $.a (string)'))

const nested = shapeOf({ a: [{ b: [{ c: 1 }] }] })
check("percorsi annidati: '$.a[].b[].c' compare in shapeOf", nested['$.a[].b[].c']?.join() === 'number', Object.keys(nested).join(','))
check('tipi ordinati e senza duplicati', shapeOf([1, 'a', null, 2])['$[]'].join() === 'null,number,string')
