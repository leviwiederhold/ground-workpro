import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const allowMissingCompanyId = new Set([
  "module_permission_templates",
  "schema_migrations",
  "spatial_ref_sys",
]);

const readMigrations = () =>
  fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: fs.readFileSync(path.join(migrationsDir, file), "utf8"),
    }));

const normalizeSql = (sql) =>
  sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

const tableCreatePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[\w]+"?)/g;
const companyColumnPattern = /(?:company_id|companyid)\s+(?:uuid|text|varchar|character varying|integer|bigint)/;

const migrations = readMigrations();
const createdTables = new Map();
const rlsEnabledTables = new Set();
const companyOwnedTables = new Set();

for (const { file, sql } of migrations) {
  const normalized = normalizeSql(sql);
  let match;
  while ((match = tableCreatePattern.exec(normalized)) !== null) {
    const table = match[1].replaceAll('"', "");
    createdTables.set(table, file);

    const createStart = match.index;
    const nextCreate = normalized.indexOf(" create table ", createStart + 1);
    const tableBlock = normalized.slice(createStart, nextCreate === -1 ? undefined : nextCreate);
    if (companyColumnPattern.test(tableBlock)) {
      companyOwnedTables.add(table);
    }
  }

  const rlsMatches = normalized.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?("?[\w]+"?)\s+enable\s+row\s+level\s+security/g
  );
  for (const rlsMatch of rlsMatches) {
    rlsEnabledTables.add(rlsMatch[1].replaceAll('"', ""));
  }
}

const missingRls = [...createdTables.keys()]
  .filter((table) => !allowMissingCompanyId.has(table))
  .filter((table) => !rlsEnabledTables.has(table));

const missingCompanyId = [...createdTables.keys()]
  .filter((table) => !allowMissingCompanyId.has(table))
  .filter((table) => !companyOwnedTables.has(table))
  .filter((table) => !table.endsWith("_view"));

if (missingRls.length > 0 || missingCompanyId.length > 0) {
  if (missingRls.length > 0) {
    console.error("Public tables missing RLS enablement:");
    for (const table of missingRls) {
      console.error(`- ${table} (${createdTables.get(table)})`);
    }
  }

  if (missingCompanyId.length > 0) {
    console.error("Public tables missing company_id audit coverage:");
    for (const table of missingCompanyId) {
      console.error(`- ${table} (${createdTables.get(table)})`);
    }
  }

  process.exit(1);
}

console.log(`Security audit passed for ${createdTables.size} public tables.`);
