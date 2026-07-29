export type AttendanceSetupEmployee = {
  id: string;
  name?: string;
  user_id?: string | null;
};

export type AttendanceSetupPermissionItem = {
  userId: string;
  automaticAttendanceConfigured: boolean;
};

export type AttendanceSetupRosterItem = AttendanceSetupEmployee & {
  configured: boolean;
};

export function buildAttendanceSetupRoster(
  employees: AttendanceSetupEmployee[],
  permissionItems: AttendanceSetupPermissionItem[],
): { items: AttendanceSetupRosterItem[]; configuredCount: number } {
  const configuredByUser = new Map<string, boolean>();
  for (const item of permissionItems) {
    configuredByUser.set(String(item.userId), Boolean(item.automaticAttendanceConfigured));
  }

  const items = employees
    .filter((employee) => Boolean(employee.user_id))
    .map((employee) => ({
      ...employee,
      configured: configuredByUser.get(String(employee.user_id)) ?? false,
    }));

  return {
    items,
    configuredCount: items.filter((item) => item.configured).length,
  };
}
