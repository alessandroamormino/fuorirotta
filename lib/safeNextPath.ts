// Percorso di ritorno dopo l'accesso: mai costruito da input grezzo (T-21-26).
// Pura, senza import: vale uguale nel browser (dialogo di accesso) e sul server
// (/accedi?next=). La libreria controlla gia' i trusted origin; questa e' la
// seconda difesa, sulla forma: una sola barra iniziale, nessuna seconda barra
// (//host e' un URL assoluto per il browser), nessun backslash (alcuni browser
// lo trattano come barra), nessuno spazio o carattere di controllo.

const MAX_LENGTH = 200

export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '/'
  if (raw.length > MAX_LENGTH) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.includes('\\') || /[\s\p{Cc}]/u.test(raw)) return '/'
  return raw
}

// Il percorso corrente senza il parametro `error` (altrimenti, dopo un
// annullamento, il ritorno riporterebbe l'avviso a ogni nuovo tentativo).
export function returnPathFrom(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete('error')
  const query = params.toString()
  return safeNextPath(query ? `${pathname}?${query}` : pathname)
}
