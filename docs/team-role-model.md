# Groundwork Pro team role model

## Canonical roles

Groundwork Pro exposes five application/access roles:

| Role | Authorization profile in this change | Notes |
| --- | --- | --- |
| Owner | Former `admin` / CEO profile | Full application access. Multiple access-role Owners are supported. |
| Administrator | Former `pm` / manager profile | Conservative initial mapping; it does **not** receive Owner access. |
| Manager | Former `pm` / manager profile | Preserves the existing manager behavior. |
| Crew Lead | Former `foreman` profile | Preserves the existing foreman behavior. |
| Team Member | Former `operator` profile for new users | Existing specialized users retain their prior profile as described below. |

These are access roles, not job titles. `job_title` remains an independent,
free-form profile field. For example, `role = team_member` and
`job_title = Equipment Operator` is valid and authorization never reads the job
title.

## Pre-migration audit

The old code had three overlapping role vocabularies:

- Membership/API roles: `admin`, `pm`, `foreman`, `mechanic`, `operator`.
- Invitation/template roles: `ceo`, `manager`, `foreman`, `mechanic`,
  `operator`, `fieldstaff`.
- UI aliases: CEO/Executive, Operations Manager, Foreman, Mechanic, Operator,
  and Field Staff.

Their shipped default authorization behavior was:

| Legacy profile | Default behavior |
| --- | --- |
| `admin` / `ceo` | Full edit access to every module; billing, integrations, settings, attendance administration, and Owner-only guards. |
| `pm` / `manager` | Broad operations access; jobs/maintenance/daily reports/safety/messages/inventory/vendors/documents/training edit; equipment and team view; finance/reports view in current source; no integrations. |
| `foreman` | Jobs/equipment/maintenance/documents/training view; daily reports/safety/messages edit; no finance/reports/team management. |
| `mechanic` | Equipment/maintenance/inventory/messages edit and safety/training view. This is specialized, not a clean hierarchy tier. |
| `operator` | Equipment/documents view and daily reports/safety/messages edit. |
| `fieldstaff` | Daily reports/safety edit, messages/documents view, and no equipment access. |

Authorization is enforced through the effective internal permission profile,
module-permission rows, route/API guards, middleware, job/equipment scoping, and
specialized work-order/schedule checks. RLS is primarily company-membership
scoped and does not define a second role hierarchy.

## Safe migration and compatibility

The migration writes only canonical values to each `role` column and records the
old behavior in `legacy_permission_profile`. The profile is internal and is
never displayed as an application role or used as a job title.

| Legacy value | Canonical role | Preserved internal profile |
| --- | --- | --- |
| `admin`, `ceo`, `co_ceo`, `executive`, `owner` | Owner | `admin` |
| `pm`, `manager`, operations/project-manager aliases | Manager | `pm` |
| `foreman` | Crew Lead | `foreman` |
| `mechanic` | Team Member | `mechanic` |
| `operator` | Team Member | `operator` |
| `fieldstaff` | Team Member | `fieldstaff` |

Released clients, cached sessions, and old invite links may continue sending
legacy values. Database triggers and server normalization translate them into
the canonical role plus preserved profile before constraints run. New invites
use only canonical values.

## Owner protections

The current schema does not have a separate company creator or billing-owner
identifier. Existing protected operations treat every top-level `admin`/CEO
membership as an Owner, and the architecture supports more than one such
membership. This change preserves that behavior and the last-Owner deletion /
demotion guard.

If Groundwork Pro later needs one creator/billing owner to have unique company
deletion, subscription-transfer, or billing powers, that identity must be added
as a separate company-level field. It must not be inferred from the access role.

## Permissions decisions intentionally deferred

- Administrator and Manager currently share the former manager profile because
  no distinct Administrator tier existed. Granting Administrator broader access
  requires a separate permissions-design decision.
- Legacy mechanic and field-staff profiles cannot be collapsed into the default
  Team Member profile without either removing access or promoting other Team
  Members. They remain compatibility profiles until permissions are redesigned
  or migrated to explicit per-user grants.
- Production template data historically drifted from source defaults for a few
  manager/field-staff modules. This migration preserves existing explicit user
  and invite permission rows and uses the current source contract for new roles;
  it does not infer permissions from role names alone.
