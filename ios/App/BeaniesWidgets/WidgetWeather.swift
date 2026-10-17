import Foundation

/// What the widgets draw for a weather reading at one instant (#134). Built only by
/// `WidgetWeather.glance`; views paint it and decide nothing.
struct WeatherGlance: Equatable {
    /// The current conditions while the current temperature is shown, else today's day glyph.
    let glyph: WSWeatherGlyph
    /// The current temperature ("27°"); nil once the reading is past `currentUntil`.
    let temp: String?
    /// Today's "32° / 26°" (home-zone day picked by the device's ymd); may be ''.
    let range: String
    /// Today's high ("32°"): the date column's fallback when the range is too wide.
    let high: String
    /// Between `ageFrom` and `currentUntil`: the temperature takes the softer ink.
    let aged: Bool
    /// "as of 7:40am" (`labels.weatherAsOf`) from `ageFrom` on, past `currentUntil` too;
    /// nil before it, or when the label is not in the file.
    let age: String?
}

/// The one native reader of `snapshot.weather`. It holds NO thresholds: the app sends the
/// instants (`ageFrom`, `currentUntil`) built from `weatherReading.ts`, so the 1h and 12h
/// rules live only in TypeScript and this only compares the device clock with them:
///   now < ageFrom                   the current glyph and temperature, no age;
///   ageFrom <= now < currentUntil   the same with the temperature in the softer ink, and the age;
///   now >= currentUntil             no current temperature: today's DAY glyph and range,
///                                   and the age.
/// A reading with no day for the device's today is no reading (the peek returns). Mirrored
/// by Android `WidgetWeather.java`; change both.
enum WidgetWeather {
    static func glance(_ weather: WSWeather?, labels: WSLabels, at date: Date) -> WeatherGlance? {
        guard let weather else { return nil }
        let today = DayResolver.ymd(date)
        guard let day = weather.days.first(where: { $0.ymd == today }) else { return nil }
        let nowMs = date.timeIntervalSince1970 * 1000
        let age = nowMs >= weather.ageFrom ? labels.weatherAsOf.map { template in
            template.replacingOccurrences(
                of: "{time}", with: WidgetClock.stamp(Date(timeIntervalSince1970: weather.fetchedAt / 1000))
            )
        } : nil

        if nowMs >= weather.currentUntil || weather.currentTemp.isEmpty {
            // Too old for "now" (or nothing to say about now): today's day glyph and range
            // carry it, never the stale current glyph.
            guard !day.range.isEmpty else { return nil }
            return WeatherGlance(
                glyph: day.glyph, temp: nil, range: day.range, high: day.high, aged: false, age: age
            )
        }
        return WeatherGlance(
            glyph: weather.currentGlyph,
            temp: weather.currentTemp,
            range: day.range,
            high: day.high,
            aged: nowMs >= weather.ageFrom,
            age: age
        )
    }
}

extension WSWeatherGlyph {
    /// The full-colour image (light and dark appearances), for the home-screen widgets.
    var asset: String { "wx-\(rawValue)" }
    /// The template image, for the tinted and clear renderings and the lock screen.
    var monoAsset: String { "wx-\(rawValue)-mono" }
}
