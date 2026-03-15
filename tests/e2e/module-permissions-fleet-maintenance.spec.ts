import { expect, test, type Page } from "@playwright/test";
import { getE2ECreds } from "./helpers";

const applyModuleAccess = async (
  page: Page,
  updates: Array<{ module_key: "fleet" | "maintenance"; access_level: "none" | "view" | "edit" }>
) => {
  const response = await page.request.post("/api/test/module-permissions", {
    data: { permissions: updates },
  });
  expect(response.status()).toBe(200);
};

test("module permissions enforce fleet and maintenance edit mutations", async ({ page }) => {
  const { email, password } = getE2ECreds();

  const login = await page.request.post("/api/test/login", {
    data: { email, password },
  });
  expect(login.status()).toBe(200);

  const setPm = await page.request.post("/api/test/set-role", {
    data: { role: "pm" },
  });
  expect(setPm.status()).toBe(200);

  await applyModuleAccess(page, [
    { module_key: "fleet", access_level: "view" },
    { module_key: "maintenance", access_level: "view" },
  ]);

  const fleetCreateBlocked = await page.request.post("/api/equipment", {
    data: { name: `perm-fleet-blocked-${Date.now()}`, status: "active" },
  });
  expect(fleetCreateBlocked.status()).toBe(403);

  await applyModuleAccess(page, [
    { module_key: "fleet", access_level: "edit" },
    { module_key: "maintenance", access_level: "view" },
  ]);

  const equipmentCreateAllowed = await page.request.post("/api/equipment", {
    data: { name: `perm-fleet-edit-${Date.now()}`, status: "active" },
  });
  expect(equipmentCreateAllowed.status()).toBe(200);
  const equipmentId = String((await equipmentCreateAllowed.json())?.equipment?.id ?? "");
  expect(equipmentId).toBeTruthy();

  const maintenanceCreateBlocked = await page.request.post("/api/work-orders", {
    data: {
      equipmentId,
      title: `perm-maint-view-${Date.now()}`,
      type: "repair",
      priority: "medium",
      status: "scheduled",
      description: "should be blocked with maintenance=view",
    },
  });
  expect(maintenanceCreateBlocked.status()).toBe(403);

  await applyModuleAccess(page, [
    { module_key: "fleet", access_level: "edit" },
    { module_key: "maintenance", access_level: "edit" },
  ]);

  const maintenanceCreateAllowed = await page.request.post("/api/work-orders", {
    data: {
      equipmentId,
      title: `perm-maint-edit-${Date.now()}`,
      type: "repair",
      priority: "medium",
      status: "scheduled",
      description: "allowed with maintenance=edit",
    },
  });
  expect(maintenanceCreateAllowed.status()).toBe(200);
  const workOrderId = String((await maintenanceCreateAllowed.json())?.workOrder?.id ?? "");
  expect(workOrderId).toBeTruthy();

  const maintenancePatchAllowed = await page.request.patch(`/api/work-orders/${workOrderId}`, {
    data: { title: `perm-maint-updated-${Date.now()}` },
  });
  expect(maintenancePatchAllowed.status()).toBe(200);

  const maintenanceDeleteAllowed = await page.request.delete(`/api/work-orders/${workOrderId}`);
  expect(maintenanceDeleteAllowed.status()).toBe(200);
});
