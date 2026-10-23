/**
 * Per quanto un evento finito resta in "Passati" (D-01). E' il numero che
 * /privacy dichiara: la lista sul dispositivo, il testo dello stato vuoto e il
 * purge notturno lato server lo condividono, cosi' non possono divergere.
 * check:privacy-pages lega il testo a questo valore.
 *
 * Modulo senza import di proposito: lo leggono sia il bundle del browser sia
 * lo script di manutenzione sull'host, che non ha altro che ../prisma.
 */
export const SAVED_RETENTION_MONTHS = 12
