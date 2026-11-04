import Foundation

/// Un gruppo della mappa: un solo evento (`id` = "p<idEvento>", stabile a ogni zoom) o 2+ eventi nella stessa cella
/// della griglia (`id` = "<livello>/<colonna>/<riga>", stabile finche' si scorre la mappa allo stesso zoom).
public struct PinGroup: Identifiable, Sendable {
    public let id: String
    public let pins: [MapPin]
    public let lat: Double
    public let lng: Double
}

private func mercatorX(_ lng: Double) -> Double { (lng + 180) / 360 }

/// Mercatore sferico nel quadrato unitario (la proiezione di MKMapPoint, scalata a 1), latitudine a +-85.
private func mercatorY(_ lat: Double) -> Double {
    let phi = min(max(lat, -85), 85) * .pi / 180
    return (1 - log(tan(.pi / 4 + phi / 2)) / .pi) / 2
}

/// I gruppi da mettere sulla mappa per la vista data: una cella ogni `cellPoints`..2x`cellPoints` punti sullo schermo,
/// solo le celle che toccano la vista allargata di un quarto per lato. Celle intere, mai tagliate dal bordo della vista:
/// cosi' scorrendo la mappa i gruppi non si rimescolano.
// ponytail: un passaggio O(n) per ogni aggiornamento sui ~9.000 pin; un indice spaziale precalcolato se il file supera
// ~100.000. `cellPoints` e' la manopola: piu' alto = bolle piu' grandi e meno numerose.
public func gridClusters(
    _ pins: [MapPin], minLat: Double, maxLat: Double, minLng: Double, maxLng: Double,
    widthPoints: Double, cellPoints: Double = 60
) -> [PinGroup] {
    guard widthPoints > 0, cellPoints > 0 else { return [] }
    // Vista a cavallo dell'antimeridiano o piu' larga del mondo: tutte le longitudini.
    let whole = max(minLng, -180) >= min(maxLng, 180)
    let x0 = whole ? 0 : mercatorX(max(minLng, -180)), x1 = whole ? 1 : mercatorX(min(maxLng, 180))
    let y0 = min(mercatorY(minLat), mercatorY(maxLat)), y1 = max(mercatorY(minLat), mercatorY(maxLat))
    let k = min(max(Int(floor(log2(widthPoints / ((x1 - x0) * cellPoints)))), 0), 30)
    let n = 1 << k, nd = Double(n)
    let mx = (x1 - x0) / 4, my = (y1 - y0) / 4
    func cell(_ v: Double) -> Int { min(max(Int(floor(v * nd)), 0), n - 1) }
    let (colLo, colHi, rowLo, rowHi) = (cell(x0 - mx), cell(x1 + mx), cell(y0 - my), cell(y1 + my))

    var cells: [Int: [Int]] = [:]
    for (i, p) in pins.enumerated() {
        guard let lat = p.lat, let lng = p.lng, lat.isFinite, lng.isFinite else { continue }
        let col = cell(mercatorX(lng))
        guard col >= colLo, col <= colHi else { continue }
        let row = cell(mercatorY(lat))
        guard row >= rowLo, row <= rowHi else { continue }
        cells[col * n + row, default: []].append(i)
    }
    return cells.map { key, idx in
        let members = idx.map { pins[$0] }
        let lat = members.reduce(0) { $0 + ($1.lat ?? 0) } / Double(members.count)
        let lng = members.reduce(0) { $0 + ($1.lng ?? 0) } / Double(members.count)
        let id = members.count == 1 ? "p\(members[0].id)" : "\(k)/\(key / n)/\(key % n)"
        return PinGroup(id: id, pins: members, lat: lat, lng: lng)
    }
}

/// Differenza tra i gruppi gia' sulla mappa (id -> id degli eventi) e quelli in arrivo: si toglie e si aggiunge solo
/// questa, mai tutto. Un gruppo con lo stesso id ma altri eventi (cambio di filtro) si toglie e si rimette.
public func groupDelta(shown: [String: [Int]], incoming: [PinGroup]) -> (add: [PinGroup], remove: [String]) {
    var remove = Set(shown.keys)
    var add: [PinGroup] = []
    for g in incoming {
        if shown[g.id] == g.pins.map(\.id) { remove.remove(g.id) } else { add.append(g) }
    }
    return (add, remove.sorted())
}
