import test from "node:test";
import assert from "node:assert/strict";
import { buildJobsiteRegions } from "../../src/lib/attendance/nativeGeofence.ts";

test("buildJobsiteRegions produces stable arrival + wake regions for a verified job", () => {
  const regions = buildJobsiteRegions(
    { jobId: "job-1", lat: 40.0, lng: -75.0, addressVerified: true },
    76,
    1609
  );
  assert.equal(regions.length, 2);
  const arrival = regions.find((r) => r.zone === "arrival");
  const wake = regions.find((r) => r.zone === "wake");
  assert.equal(arrival?.identifier, "job-1:arrival");
  assert.equal(arrival?.radiusMeters, 76);
  assert.equal(wake?.identifier, "job-1:wake");
  assert.equal(wake?.radiusMeters, 1609);
  assert.equal(arrival?.latitude, 40.0);
  assert.equal(arrival?.longitude, -75.0);
});

test("buildJobsiteRegions returns nothing for unverified or coordinate-less jobs", () => {
  assert.deepEqual(buildJobsiteRegions({ jobId: "j", lat: 40, lng: -75, addressVerified: false }, 76, 1609), []);
  assert.deepEqual(buildJobsiteRegions({ jobId: "j", lat: null, lng: null, addressVerified: true }, 76, 1609), []);
});

test("region identifiers round-trip to jobId:zone (the native transition contract)", () => {
  const [arrival] = buildJobsiteRegions({ jobId: "abc", lat: 1, lng: 2, addressVerified: true }, 50, 800);
  const [jobId, zone] = arrival.identifier.split(":");
  assert.equal(jobId, "abc");
  assert.equal(zone, "arrival");
});
