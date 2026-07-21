package com.groundworkpro.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// The durable offline attendance queue, shared between the native geofence
// receiver and the JS layer.
//
// This is what makes "native enter/exit events reach the offline queue" true.
// When a background transition cannot be POSTed — no signal, no credential yet,
// server error — it is appended HERE, to the same file AttendanceQueueStorePlugin
// serves to JavaScript. The web layer then flushes it with its full retry policy
// (exponential backoff, quarantine, per-job ordering).
//
// One queue, one reported depth. A separate native queue would make diagnostics
// show two different numbers, neither of them the truth.
//
// The on-disk shape must match src/lib/attendance/offlineQueue.ts exactly:
//   { version: 2, events: [ … ], meta: { … } }
object AttendanceNativeQueue {
    const val SCHEMA_VERSION = 2
    const val FILE_NAME = "attendance-queue.json"

    private val lock = Any()

    fun queueFile(context: Context): File = File(context.filesDir, FILE_NAME)

    fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date())

    /**
     * The stable event id the JS layer uses. Truncating to the minute is what
     * collapses a duplicate OS delivery of the same transition into one event.
     */
    fun makeEventId(jobId: String, zone: String, transition: String, occurredAt: String): String {
        val minute = occurredAt.take(16) // YYYY-MM-DDTHH:mm
        return listOf(jobId, zone, transition, minute).joinToString("|")
    }

    fun read(context: Context): JSONObject = try {
        val file = queueFile(context)
        if (file.exists()) JSONObject(file.readText()) else emptyPayload()
    } catch (e: Exception) {
        // Corrupted (e.g. a kill mid-write). An empty queue beats throwing on
        // every attendance path.
        emptyPayload()
    }

    private fun emptyPayload() = JSONObject()
        .put("version", SCHEMA_VERSION)
        .put("events", JSONArray())
        .put("meta", JSONObject())

    private fun write(context: Context, payload: JSONObject) {
        try {
            // Write-then-rename so a kill mid-write cannot leave a truncated queue.
            val target = queueFile(context)
            val temp = File(context.filesDir, "$FILE_NAME.tmp")
            temp.writeText(payload.toString())
            if (!temp.renameTo(target)) {
                target.writeText(payload.toString())
                temp.delete()
            }
        } catch (e: Exception) {
            // Best effort — losing the write is bad, crashing the receiver is worse.
        }
    }

    /**
     * Append a transition unless one with the same id is already queued.
     * Synchronized because the geofencing API can deliver two transitions in
     * rapid succession and a read-modify-write race would drop one.
     */
    fun enqueue(
        context: Context,
        jobId: String,
        zone: String,
        transition: String,
        occurredAt: String,
        deviceId: String?
    ) = synchronized(lock) {
        val payload = read(context)
        val events = payload.optJSONArray("events") ?: JSONArray()
        val eventId = makeEventId(jobId, zone, transition, occurredAt)

        for (i in 0 until events.length()) {
            if (events.optJSONObject(i)?.optString("eventId") == eventId) return@synchronized
        }

        val now = isoNow()
        events.put(
            JSONObject()
                .put("eventId", eventId)
                .put("jobId", jobId)
                .put("assignmentId", JSONObject.NULL)
                .put("deviceId", deviceId ?: JSONObject.NULL)
                .put("zone", zone)
                .put("transition", transition)
                // The ORIGINAL time. Never rewritten at flush time.
                .put("occurredAt", occurredAt)
                .put("latitude", JSONObject.NULL)
                .put("longitude", JSONObject.NULL)
                .put("accuracyMeters", JSONObject.NULL)
                .put("source", "jobsite_auto")
                .put("attempts", 0)
                .put("queuedAt", now)
                .put("nextAttemptAt", now)
                .put("state", "pending")
                .put("lastError", JSONObject.NULL)
                .put("lastAttemptAt", JSONObject.NULL)
        )

        payload.put("version", SCHEMA_VERSION).put("events", events)
        write(context, payload)
    }

    /** Number of events still waiting. Read by getHealth(). */
    fun pendingCount(context: Context): Int {
        val events = read(context).optJSONArray("events") ?: return 0
        var count = 0
        for (i in 0 until events.length()) {
            if (events.optJSONObject(i)?.optString("state", "pending") == "pending") count += 1
        }
        return count
    }
}
