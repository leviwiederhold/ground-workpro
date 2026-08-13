import Foundation

// The durable offline attendance queue, shared between the native geofence
// handler and the JS layer.
//
// This is the piece that makes "native enter/exit events reach the offline
// queue" true. When a background transition cannot be POSTed — no signal, no
// credential yet, server error — it is appended HERE, to the same file
// AttendanceQueueStorePlugin serves to JavaScript. The web layer then flushes it
// with its full retry policy (exponential backoff, quarantine, ordering).
//
// One queue, one reported depth. If the native side kept its own separate
// queue, diagnostics would show two different numbers and neither would be the
// truth.
//
// The on-disk shape must match src/lib/attendance/offlineQueue.ts exactly:
//   { version: 2, events: [ … ], meta: { … } }
enum AttendanceNativeQueue {
    static let schemaVersion = 2

    private static let ioQueue = DispatchQueue(label: "com.groundworkpro.attendance.queue")

    static func fileURL() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = base.appendingPathComponent("GroundworkPro", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("attendance-queue.json")
    }

    /// The stable event id the JS layer uses. Truncating to the minute is what
    /// makes a duplicate OS delivery of the same transition collapse to one
    /// event — iOS can and does deliver a region transition more than once.
    static func makeEventId(jobId: String, zone: String, transition: String, occurredAt: String) -> String {
        let minute = String(occurredAt.prefix(16)) // YYYY-MM-DDTHH:mm
        return [jobId, zone, transition, minute].joined(separator: "|")
    }

    private static func readUnlocked() -> [String: Any] {
        guard
            let url = try? fileURL(),
            FileManager.default.fileExists(atPath: url.path),
            let data = try? Data(contentsOf: url),
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return ["version": schemaVersion, "events": [], "meta": [:]]
        }
        return parsed
    }

    static func read() -> [String: Any] {
        ioQueue.sync { readUnlocked() }
    }

    @discardableResult
    private static func writeUnlocked(_ payload: [String: Any]) -> Bool {
        guard
            let url = try? fileURL(),
            let data = try? JSONSerialization.data(withJSONObject: payload)
        else { return false }
        // Atomic + protected until first unlock: the region handler can be
        // woken after a reboot before the user has unlocked the phone, and must
        // still be able to append.
        do {
            try data.write(
                to: url,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            return true
        } catch {
            return false
        }
    }

    /// Append a transition, unless an event with the same id is already queued.
    /// Serialized on a private queue so two near-simultaneous region callbacks
    /// cannot interleave a read-modify-write and lose one.
    @discardableResult
    static func enqueue(
        jobId: String,
        zone: String,
        transition: String,
        occurredAt: String,
        latitude: Double?,
        longitude: Double?,
        accuracyMeters: Double?,
        deviceId: String?
    ) -> String? {
        ioQueue.sync {
            var payload = readUnlocked()
            var events = payload["events"] as? [[String: Any]] ?? []
            let eventId = makeEventId(jobId: jobId, zone: zone, transition: transition, occurredAt: occurredAt)
            if events.contains(where: { $0["eventId"] as? String == eventId }) { return eventId }

            let now = ISO8601DateFormatter.attendance.string(from: Date())
            events.append([
                "eventId": eventId,
                "jobId": jobId,
                "assignmentId": NSNull(),
                "deviceId": deviceId ?? NSNull(),
                "zone": zone,
                "transition": transition,
                // The ORIGINAL time. Never rewritten at flush time.
                "occurredAt": occurredAt,
                "latitude": latitude ?? NSNull(),
                "longitude": longitude ?? NSNull(),
                "accuracyMeters": accuracyMeters ?? NSNull(),
                "source": "jobsite_auto",
                "attempts": 0,
                "queuedAt": now,
                "nextAttemptAt": now,
                "state": "pending",
                "lastError": NSNull(),
                "lastAttemptAt": NSNull()
            ])

            payload["version"] = schemaVersion
            payload["events"] = events
            guard writeUnlocked(payload) else { return nil }
            // Mirrored for getHealth(), so diagnostics report a real depth.
            UserDefaults.standard.set(events.count, forKey: "gw_pending_queue_count")
            return eventId
        }
    }

    /// Pending records in original occurrence order. Native delivery uses this
    /// directly, so an event queued while the WebView is absent can drain on a
    /// later Core Location wake without requiring an app launch.
    static func pendingEvents() -> [[String: Any]] {
        ioQueue.sync {
            let events = readUnlocked()["events"] as? [[String: Any]] ?? []
            return events
                .filter { ($0["state"] as? String ?? "pending") == "pending" }
                .sorted {
                    String(describing: $0["occurredAt"] ?? "") <
                        String(describing: $1["occurredAt"] ?? "")
                }
        }
    }

    /// Remove only after the server returns 2xx. The transition is written
    /// before the first HTTP attempt, so suspension/crash cannot create a gap
    /// between a callback and its durable record.
    static func markDelivered(eventId: String) {
        ioQueue.sync {
            var payload = readUnlocked()
            var events = payload["events"] as? [[String: Any]] ?? []
            events.removeAll { $0["eventId"] as? String == eventId }
            var meta = payload["meta"] as? [String: Any] ?? [:]
            meta["lastSuccessfulSyncAt"] = ISO8601DateFormatter.attendance.string(from: Date())
            payload["events"] = events
            payload["meta"] = meta
            writeUnlocked(payload)
            UserDefaults.standard.set(events.count, forKey: "gw_pending_queue_count")
        }
    }

    /// Keep a failed record pending and persist the reason. JavaScript and
    /// future native wakes share this state; neither path can silently drop it.
    static func markFailed(eventId: String, reason: String) {
        ioQueue.sync {
            var payload = readUnlocked()
            var events = payload["events"] as? [[String: Any]] ?? []
            let now = ISO8601DateFormatter.attendance.string(from: Date())
            for index in events.indices where events[index]["eventId"] as? String == eventId {
                let attempts = (events[index]["attempts"] as? Int ?? 0) + 1
                events[index]["attempts"] = attempts
                events[index]["lastAttemptAt"] = now
                events[index]["lastError"] = reason
                // A future native wake may retry. The JS retry policy may apply
                // its more detailed auth/permanent classification when open.
                events[index]["nextAttemptAt"] = ISO8601DateFormatter.attendance.string(
                    from: Date().addingTimeInterval(30)
                )
            }
            var meta = payload["meta"] as? [String: Any] ?? [:]
            meta["lastFailureAt"] = now
            meta["lastFailureReason"] = reason
            payload["events"] = events
            payload["meta"] = meta
            writeUnlocked(payload)
            UserDefaults.standard.set(events.count, forKey: "gw_pending_queue_count")
        }
    }

    /// Preserve a server-rejected record for diagnostics without letting it
    /// block later valid enter/exit events forever. This matches the shared JS
    /// queue's permanent-failure behavior; quarantined records are retained and
    /// pruned only by the existing retention policy.
    static func markQuarantined(eventId: String, reason: String) {
        ioQueue.sync {
            var payload = readUnlocked()
            var events = payload["events"] as? [[String: Any]] ?? []
            let now = ISO8601DateFormatter.attendance.string(from: Date())
            for index in events.indices where events[index]["eventId"] as? String == eventId {
                events[index]["attempts"] = (events[index]["attempts"] as? Int ?? 0) + 1
                events[index]["lastAttemptAt"] = now
                events[index]["lastError"] = reason
                events[index]["state"] = "quarantined"
            }
            var meta = payload["meta"] as? [String: Any] ?? [:]
            meta["lastFailureAt"] = now
            meta["lastFailureReason"] = reason
            payload["events"] = events
            payload["meta"] = meta
            writeUnlocked(payload)
            UserDefaults.standard.set(
                events.filter { ($0["state"] as? String ?? "pending") == "pending" }.count,
                forKey: "gw_pending_queue_count"
            )
        }
    }

    /// Number of events still waiting. Read by getHealth().
    static func pendingCount() -> Int {
        ioQueue.sync {
            let events = readUnlocked()["events"] as? [[String: Any]] ?? []
            return events.filter { ($0["state"] as? String ?? "pending") == "pending" }.count
        }
    }
}

extension ISO8601DateFormatter {
    /// Milliseconds included, to match the JS layer's `toISOString()` output —
    /// the two sides compare and dedupe these strings.
    static let attendance: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
