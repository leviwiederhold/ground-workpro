import type { AssignedJobLocation } from "../jobsite-time/domain";
import { buildJobsiteRegions, type GeofenceRegion } from "./nativeGeofence";

/**
 * Build the one authoritative desired native region set for assigned jobs.
 *
 * Both startup validation and registration call this helper so they cannot
 * disagree about whether a redundant wake region should exist.
 */
export async function loadAssignedAttendanceRegions(
  jobs: Array<AssignedJobLocation & { name?: string }>,
): Promise<GeofenceRegion[]> {
  const settingsRes = await fetch("/api/jobsite-time/settings", { cache: "no-store" });
  if (!settingsRes.ok) throw new Error("Could not load location settings");
  const settings = (await settingsRes.json().catch(() => null))?.item ?? null;
  const arrivalRadiusMeters = settings?.arrivalRadiusFeet
    ? Number(settings.arrivalRadiusFeet) * 0.3048
    : 76;
  const wakeRadiusMeters = Number(settings?.wakeRadiusMeters ?? 1609);
  const regions = jobs
    .filter((job) => job.addressVerified && job.lat !== null && job.lng !== null)
    .slice(0, 10)
    .flatMap((job) =>
      buildJobsiteRegions(job, arrivalRadiusMeters, wakeRadiusMeters),
    );
  if (regions.length === 0) throw new Error("No assigned location is ready");
  return regions;
}
