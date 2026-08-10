import { OPERATIONAL_GROUP_DEFAULTS } from "./operational-groups";

export async function ensureOperationalGroups(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS operational_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    short_name TEXT,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS operational_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES operational_groups(id),
    resource_kind TEXT NOT NULL CHECK(resource_kind IN ('guard','post','vehicle')),
    resource_id INTEGER NOT NULL,
    team_label TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id,resource_kind,resource_id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_operational_group_members_resource ON operational_group_members(resource_kind,resource_id)").run();
  await db.batch(OPERATIONAL_GROUP_DEFAULTS.map((group) => db.prepare(
    "INSERT OR IGNORE INTO operational_groups (name,short_name,color,sort_order) VALUES (?,?,?,?)",
  ).bind(group.name, group.short_name, group.color, group.sort_order)));
}
