-- Drop the plan_type check constraint that was blocking "groundwork_pro" as a valid value.
-- The constraint is not defined in migrations (must have been created manually in the dashboard)
-- and it rejects values like "groundwork_pro" that the billing sync writes.
-- plan_type is a free-form text identifier — no enum constraint needed.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_plan_type_check;
