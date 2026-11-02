// Specchio di lib/api-contract.ts (piu' CANONICAL_CATEGORIES, i tetti GUEST_CAP/ACCOUNT_CAP e PLACE_CAP dei follow).
// Si modifica SOLO insieme a quel file: check:ios-contract (test:ci) fallisce se i valori divergono.
// Una `static let` per riga, valori letterali: il gate li legge come testo.

public enum ApiContract {
    public static let plan = "beta"
    public static let features = ["saved", "follows", "calendar-feed", "share", "push"]
    public static let apnsEnvironments = ["sandbox", "production"]
    public static let apnsTokenPattern = #"^[0-9a-fA-F]{64,200}$"#
    public static let deviceCap = 10
    public static let userAgentPattern = #"^FuoriRotta\/\d+(?:\.\d+){0,3} \((?:iOS|Android); (iPhone|iPad|Android)\)"#
    public static let universalLinkPaths = ["/eventi/*", "/l/*"]
    public static let categories = ["Sagre e feste", "Musica e spettacolo", "Arte e cultura", "Fiere e mercati", "Sport e outdoor", "Food & Wine", "Altro"]
    public static let savedListItemKeys = ["ref", "eventId", "savedAt", "snap", "live", "imageUrl", "siblings"]
    public static let savedResolveItemKeys = ["ref", "eventId", "live", "imageUrl", "siblings"]
    public static let guestCap = 100
    public static let accountCap = 500
    public static let placeCap = 50
    public static let eventComuneKeys = ["istatCode", "name", "provinceCode", "provinceName"]
    public static let comuneSearchItemKeys = ["id", "istatCode", "name", "provinceName", "regionName", "latitude", "longitude"]
}
