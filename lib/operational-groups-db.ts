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
  // A resource can belong to a different operational group in each ideal
  // 12x36 pattern.  Keep this contextual layer separate from the global
  // catalog link so editing D1/D2/N1/N2 never changes another team by
  // accident.
  await db.prepare(`CREATE TABLE IF NOT EXISTS pattern_operational_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_id INTEGER NOT NULL REFERENCES shift_patterns(id),
    group_id INTEGER NOT NULL REFERENCES operational_groups(id),
    resource_kind TEXT NOT NULL CHECK(resource_kind IN ('guard','post','vehicle')),
    resource_id INTEGER NOT NULL,
    team_label TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pattern_id,resource_kind,resource_id)
  )`).run();
  // These optional fields make a pattern membership operational rather than
  // merely classificatory: a GM can be assigned to a specific turn and VTR
  // without changing the normal resource catalog.  Older databases do not
  // have the columns, so upgrade them in place before any query selects them.
  const patternColumns = new Set(
    (await db.prepare("PRAGMA table_info(pattern_operational_group_members)").all<{ name: string }>()).results
      .map((column) => column.name),
  );
  for (const [name, definition] of [
    ["shift", "TEXT"],
    ["vehicle_id", "INTEGER"],
    ["starts_at", "TEXT"],
    ["ends_at", "TEXT"],
  ] as const) {
    if (!patternColumns.has(name)) {
      await db.prepare(`ALTER TABLE pattern_operational_group_members ADD COLUMN ${name} ${definition}`).run();
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_operational_group_members_resource ON operational_group_members(resource_kind,resource_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_pattern_operational_group_members_pattern ON pattern_operational_group_members(pattern_id,resource_kind,resource_id)").run();
  await db.batch(OPERATIONAL_GROUP_DEFAULTS.map((group) => db.prepare(
    "INSERT OR IGNORE INTO operational_groups (name,short_name,color,sort_order) VALUES (?,?,?,?)",
  ).bind(group.name, group.short_name, group.color, group.sort_order)));
}
