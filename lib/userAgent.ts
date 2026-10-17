// User agent -> etichetta italiana del dispositivo ("Chrome su Mac"), senza
// dipendenze (D-08). Pura: vale sul server e nei gate.
//
// L'ordine dei controlli conta, perche' gli user agent si mimano a vicenda:
// Edge dichiara anche Chrome/ e Safari/, Chrome dichiara Safari/, iPhone e
// iPad dichiarano "Mac OS X", Android dichiara Linux.
// ponytail: euristica, non un parser completo; un browser raro cade in
// 'Browser sconosciuto'. Se serve di piu', ua-parser-js.

export type DeviceKind = 'phone' | 'tablet' | 'desktop'

const UNKNOWN = { label: 'Browser sconosciuto', kind: 'desktop' } as const

export function deviceLabel(ua: string | null | undefined): { label: string; kind: DeviceKind } {
  if (!ua) return { ...UNKNOWN }
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null
  const [platform, kind]: [string, DeviceKind] | [null, DeviceKind] =
    /iPad/.test(ua) ? ['iPad', 'tablet']
    : /iPhone/.test(ua) ? ['iPhone', 'phone']
    : /Android/.test(ua) ? ['Android', /Mobile/.test(ua) ? 'phone' : 'tablet']
    : /Windows/.test(ua) ? ['Windows', 'desktop']
    : /Mac OS X/.test(ua) ? ['Mac', 'desktop']
    : /Linux/.test(ua) ? ['Linux', 'desktop']
    : [null, 'desktop']
  if (!browser || !platform) return { ...UNKNOWN }
  return { label: `${browser} su ${platform}`, kind }
}
