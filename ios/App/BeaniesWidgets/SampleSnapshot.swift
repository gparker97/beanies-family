import Foundation

/// The built-in sample for the widget gallery and the placeholder (redacted by the system).
/// The mockup's family, Sam, Jo, Ava and Max: a busy today, a to-dos section, a look-ahead
/// with tomorrow's piano and Jo's birthday the day after, and a fresh weather reading. Dates are today's and
/// the next six days', in the device's locale; the item text is illustrative and is never
/// shown for a placed, signed-in widget.
enum SampleSnapshot {
    static func make(now: Date) -> WSSnapshot {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: now)

        /// Midnight `offset` days from today.
        func date(_ offset: Int) -> Date {
            calendar.date(byAdding: .day, value: offset, to: startOfToday) ?? startOfToday
        }
        /// Epoch ms of hour:minute, `offset` days from today.
        func at(_ hour: Int, _ minute: Int, _ offset: Int) -> Double {
            let midnight = date(offset)
            let instant = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: midnight) ?? midnight
            return instant.timeIntervalSince1970 * 1000
        }
        func format(_ pattern: String, _ offset: Int) -> String {
            let formatter = DateFormatter()
            formatter.locale = Locale.current
            formatter.setLocalizedDateFormatFromTemplate(pattern)
            return formatter.string(from: date(offset))
        }
        func entry(_ offset: Int, _ content: WSDay) -> WSDayEntry {
            WSDayEntry(
                ymd: DayResolver.ymd(date(offset)),
                numeral: format("d", offset),
                weekday: format("EEEE", offset),
                month: format("MMMM", offset),
                weekdayShort: format("EEE", offset),
                dividerDate: format("EEE d", offset),
                my: content,
                our: content
            )
        }

        let nook = WidgetLinks.nookFallback
        let sam = WSDot.member(initial: "S", color: "#2C3E50", ink: "#FFFFFF")
        let jo = WSDot.member(initial: "J", color: "#AED6F1", ink: "#2C3E50")
        let ava = WSDot.member(initial: "A", color: "#E67E22", ink: "#2C3E50")
        let maxDot = WSDot.member(initial: "M", color: "#27AE60", ink: "#FFFFFF")

        let rows: [WSRow] = [
            WSRow(id: "s1", time: "8:30am", startsAt: at(8, 30, 0), endsAt: at(9, 30, 0), title: "swimming",
                  who: "Ava", shortTitle: "swimming", whoFirst: "Ava", dot: ava, link: nook),
            WSRow(id: "s2", time: "10:15am", startsAt: at(10, 15, 0), endsAt: at(11, 0, 0), title: "piano",
                  who: "Max", shortTitle: "piano", whoFirst: "Max", dot: maxDot,
                  handoff: WSHandoff(inlineTitle: nil, line: "Sam drops off, Jo picks up 11:00",
                                     avatars: ["father", "mother"]),
                  link: nook),
            WSRow(id: "s3", time: "12:30pm", startsAt: at(12, 30, 0), endsAt: at(14, 0, 0), title: "lunch at grandma's",
                  who: "", shortTitle: "lunch", whoFirst: "", dot: .family, link: nook),
            WSRow(id: "s4", time: "3:00pm", startsAt: at(15, 0, 0), endsAt: at(17, 0, 0), title: "birthday party",
                  who: "Ava", shortTitle: "birthday", whoFirst: "Ava", dot: ava, link: nook),
            WSRow(id: "s5", time: "5:30pm", startsAt: at(17, 30, 0), endsAt: at(18, 0, 0), title: "soccer pick-up",
                  who: "Jo", shortTitle: "soccer", whoFirst: "Jo", dot: jo, link: nook),
        ]

        let tasks = WSTasks(
            items: [
                WSTask(id: "t1", kind: .todo, bucket: "overdue", title: "call the dentist", tag: "overdue",
                       tagIsAccent: true, link: nook),
                WSTask(id: "t2", kind: .todo, bucket: "today", title: "permission slip", tag: "by 5pm",
                       tagIsAccent: true, timed: true, dot: ava, link: nook),
                WSTask(id: "t3", kind: .hint, bucket: "today", title: "wrap the present", tag: "today",
                       tagIsAccent: true, link: nook),
                WSTask(id: "t4", kind: .list, bucket: "later", title: "groceries, 6 left", tag: format("EEE d", 2),
                       tagIsAccent: false, link: nook),
            ],
            heading: "to-dos and lists",
            count: 3,
            countText: WSText(text: "3 for you today", emphasis: "3"),
            doneToday: 1,
            link: nook
        )

        let today = WSDay(
            rows: rows,
            tonight: WSTonight(text: "tonight: tacos, Sam cooks", emphasis: "tacos", link: nook),
            tasks: tasks,
            thingsText: "5 things on today",
            pickups: [WSPickup(at: at(11, 0, 0), text: "pick-up 11:00am, Max")],
            handoffs: [
                WSDayHandoff(at: at(10, 15, 0), kind: .dropoff, name: "Max", link: nook),
            ]
        )

        // The look-ahead: an activity tomorrow, a birthday the day after, then a quiet week.
        var later: [[WSRow]] = Array(repeating: [], count: 6)
        later[0] = [
            WSRow(id: "l1", time: "4:30pm", startsAt: at(16, 30, 1), endsAt: at(17, 30, 1), title: "piano",
                  who: "Max", shortTitle: "piano", whoFirst: "Max", dot: maxDot,
                  handoff: WSHandoff(inlineTitle: "piano, Jo drives", line: nil, avatars: ["mother"]),
                  link: nook),
        ]
        later[1] = [
            WSRow(id: "l2", kind: .birthday, time: "", title: "Jo's birthday", who: "Jo", shortTitle: "Jo's", whoFirst: "Jo", dot: jo, link: nook),
            WSRow(id: "l3", time: "6:00pm", startsAt: at(18, 0, 2), endsAt: at(19, 0, 2), title: "parents' evening",
                  who: "Sam", shortTitle: "parents'", whoFirst: "Sam", dot: sam, link: nook),
        ]

        var days = [entry(0, today)]
        for (index, laterRows) in later.enumerated() {
            days.append(entry(index + 1, WSDay(rows: laterRows, tasks: tasks, thingsText: "")))
        }

        // Fresh: the age shows an hour after `now`, the temperature hides twelve after.
        let nowMs = now.timeIntervalSince1970 * 1000
        let forecast: [(WSWeatherGlyph, String, String)] = [
            (.partly, "68°", "54°"), (.rain, "61°", "50°"), (.cloudy, "63°", "51°"),
            (.sunny, "70°", "53°"), (.partly, "66°", "52°"),
        ]
        let weather = WSWeather(
            fetchedAt: nowMs,
            ageFrom: nowMs + 3600 * 1000,
            currentUntil: nowMs + 12 * 3600 * 1000,
            currentGlyph: .partly,
            currentTemp: "64°",
            currentCondition: "Partly cloudy",
            days: forecast.enumerated().map { offset, day in
                WSWeatherDay(
                    ymd: DayResolver.ymd(date(offset)), glyph: day.0, high: day.1, low: day.2,
                    range: "\(day.1) / \(day.2)"
                )
            }
        )

        var labels = WSLabels()
        labels.weatherAsOf = "as of {time}"
        labels.circleLeft = "left"
        labels.circleAllDone = "all done"
        labels.circleAllClear = "all clear"
        labels.circleToDo = "to do"

        return WSSnapshot(
            version: WidgetSnapshotStore.supportedVersions.upperBound,
            generatedAt: ISO8601DateFormatter().string(from: now),
            familyIdTail: "",
            viewer: WSViewer(memberId: "", firstName: "Sam", avatar: "father", isChild: false),
            settings: WSSettings(lockScreenTitles: true),
            labels: labels,
            links: WSLinks(),
            days: days,
            weather: weather
        )
    }
}
