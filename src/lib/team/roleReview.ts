export function isEmployeeRoleReviewPending(input: {
  joinedViaCompanyCodeAt: unknown;
  roleReviewedAt: unknown;
  currentRole: unknown;
}): boolean {
  if (!String(input.joinedViaCompanyCodeAt ?? "").trim()) return false;
  if (input.roleReviewedAt) return false;

  const role = String(input.currentRole ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return role === "operator" || role === "employee" || role === "teammember";
}

export type TeamRolePresentation = {
  label: string;
  access: string;
};

export function getTeamRolePresentation(rawRole: unknown): TeamRolePresentation {
  const role = String(rawRole ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (role === "owner") {
    return { label: "Owner", access: "Company owner · Full web and mobile access" };
  }
  if (["co_owner", "admin", "ceo", "executive"].includes(role)) {
    return { label: "Co-Owner", access: "Full web and mobile access · Owner-level permissions" };
  }
  if (role === "administrator") {
    return { label: "Administrator", access: "Mobile app · Administrator permissions" };
  }
  if (["pm", "manager", "operations"].includes(role)) {
    return { label: "Manager", access: "Mobile app · Manager permissions" };
  }
  if (role === "foreman" || role === "crew_lead" || role === "crew lead") {
    return { label: "Crew Lead", access: "Mobile app · Crew Lead permissions" };
  }
  if (role === "mechanic") {
    return { label: "Mechanic", access: "Mobile app · Mechanic permissions" };
  }
  if (role === "fieldstaff" || role === "field_staff" || role === "field staff") {
    return { label: "Field Staff", access: "Mobile app · Limited field access" };
  }
  return { label: "Employee", access: "Mobile app · Standard field access" };
}
