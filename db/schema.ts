import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const audit = {
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), email: text("email").notNull().unique(), name: text("name").notNull(),
  role: text("role", { enum:["admin","editor","viewer","guard"] }).notNull().default("viewer"), active: integer("active",{mode:"boolean"}).notNull().default(true), ...audit,
});
export const guards = sqliteTable("guards", {
  id: integer("id").primaryKey({autoIncrement:true}), registration: text("registration").notNull().unique(), name:text("name").notNull(),
  platoon:text("platoon"), baseShift:text("base_shift"), active:integer("active",{mode:"boolean"}).notNull().default(true), ...audit,
  workRegime:text("work_regime",{enum:["12x36","weekly"]}).notNull().default("12x36"),
  overtimeEligible:integer("overtime_eligible",{mode:"boolean"}).notNull().default(true),
  overtimeNote:text("overtime_note"),
});
export const posts = sqliteTable("posts", {
  id:integer("id").primaryKey({autoIncrement:true}), name:text("name").notNull(), groupName:text("group_name").notNull(), sortOrder:integer("sort_order").notNull().default(0), active:integer("active",{mode:"boolean"}).notNull().default(true), ...audit,
});
export const vehicles = sqliteTable("vehicles", {
  id:integer("id").primaryKey({autoIncrement:true}), prefix:text("prefix").notNull().unique(), type:text("type",{enum:["sedan","pickup","van","moto","suv","other"]}).notNull(), zone:text("zone"), active:integer("active",{mode:"boolean"}).notNull().default(true), ...audit,
});
export const schedules = sqliteTable("schedules", {
  id:integer("id").primaryKey({autoIncrement:true}), date:text("date").notNull(), status:text("status",{enum:["draft","validated","published"]}).notNull().default("draft"), publishedAt:text("published_at"), ...audit,
},t=>[uniqueIndex("idx_schedules_date").on(t.date)]);
export const assignments = sqliteTable("assignments", {
  id:integer("id").primaryKey({autoIncrement:true}), scheduleId:integer("schedule_id").notNull().references(()=>schedules.id), guardId:integer("guard_id").notNull().references(()=>guards.id),
  postId:integer("post_id").references(()=>posts.id), vehicleId:integer("vehicle_id").references(()=>vehicles.id), shift:text("shift").notNull(), role:text("role",{enum:["guard","driver","patrol","third"]}).notNull().default("guard"), startsAt:text("starts_at").notNull(), endsAt:text("ends_at").notNull(), regularEndsAt:text("regular_ends_at"), breakStartsAt:text("break_starts_at"), breakEndsAt:text("break_ends_at"), workKind:text("work_kind").notNull().default("shift"), status:text("status",{enum:["normal","overtime","time_bank","swap"]}).notNull().default("normal"), requestRef:text("request_ref"), isReassigned:integer("is_reassigned",{mode:"boolean"}).notNull().default(false), reassignmentNote:text("reassignment_note"), ...audit,
},t=>[uniqueIndex("idx_assignments_schedule_guard_time").on(t.scheduleId,t.guardId,t.startsAt)]);
export const weeklySlots = sqliteTable("weekly_slots", {id:integer("id").primaryKey({autoIncrement:true}),guardId:integer("guard_id").notNull().references(()=>guards.id),weekdays:text("weekdays").notNull().default("1,2,3,4,5"),postId:integer("post_id").references(()=>posts.id),vehicleId:integer("vehicle_id").references(()=>vehicles.id),role:text("role").notNull().default("guard"),startsAt:text("starts_at").notNull().default("08:00"),breakStart:text("break_start"),breakEnd:text("break_end"),regularEnd:text("regular_end").notNull().default("17:00"),overtimeEnd:text("overtime_end"),active:integer("active",{mode:"boolean"}).notNull().default(true),...audit},t=>[uniqueIndex("idx_weekly_slots_guard").on(t.guardId)]);
export const vehicleOutages = sqliteTable("vehicle_outages", {id:integer("id").primaryKey({autoIncrement:true}),vehicleId:integer("vehicle_id").notNull().references(()=>vehicles.id),startsOn:text("starts_on").notNull(),endsOn:text("ends_on"),reason:text("reason"),active:integer("active",{mode:"boolean"}).notNull().default(true),...audit});
export const scheduleSections=sqliteTable("schedule_sections",{sectionKey:text("section_key").primaryKey(),label:text("label").notNull(),sortOrder:integer("sort_order").notNull().default(0),updatedAt:text("updated_at").notNull().default("CURRENT_TIMESTAMP")});
export const movements = sqliteTable("movements", {
  id:integer("id").primaryKey({autoIncrement:true}), guardId:integer("guard_id").notNull().references(()=>guards.id), type:text("type",{enum:["day_off","vacation","course","medical_leave","technical_reserve","time_bank","swap"]}).notNull(), startsAt:text("starts_at").notNull(), endsAt:text("ends_at").notNull(), requestRef:text("request_ref"), notes:text("notes"), status:text("status",{enum:["pending","approved","rejected"]}).notNull().default("approved"), ...audit,
});
export const leaveCampaigns = sqliteTable("leave_campaigns", {
  id:integer("id").primaryKey({autoIncrement:true}), month:text("month").notNull().unique(), title:text("title").notNull(), weekdayQuota:integer("weekday_quota").notNull().default(1), weekendQuota:integer("weekend_quota").notNull().default(1), status:text("status",{enum:["draft","open","closed","published"]}).notNull().default("draft"), accessCode:text("access_code").notNull(), ...audit,
});
export const leaveDayLimits = sqliteTable("leave_day_limits", {
 id:integer("id").primaryKey({autoIncrement:true}), campaignId:integer("campaign_id").notNull().references(()=>leaveCampaigns.id), date:text("date").notNull(), platoon:text("platoon"), capacity:integer("capacity").notNull(), ...audit,
},t=>[uniqueIndex("idx_leave_limits_campaign_date_platoon").on(t.campaignId,t.date,t.platoon)]);
export const leaveChoices = sqliteTable("leave_choices", {
 id:integer("id").primaryKey({autoIncrement:true}), campaignId:integer("campaign_id").notNull().references(()=>leaveCampaigns.id), guardId:integer("guard_id").notNull().references(()=>guards.id), date:text("date").notNull(), category:text("category",{enum:["weekday","weekend"]}).notNull(), status:text("status",{enum:["confirmed","waitlist","cancelled"]}).notNull(), position:integer("position"), ...audit,
},t=>[uniqueIndex("idx_leave_choices_campaign_guard_category").on(t.campaignId,t.guardId,t.category)]);
export const shiftPatterns = sqliteTable("shift_patterns", {
 id:integer("id").primaryKey({autoIncrement:true}), code:text("code").notNull().unique(), name:text("name").notNull(), period:text("period",{enum:["day","night"]}).notNull(), parity:integer("parity").notNull(), anchorDate:text("anchor_date").notNull(), active:integer("active",{mode:"boolean"}).notNull().default(true), ...audit,
});
export const patternSlots = sqliteTable("pattern_slots", {
 id:integer("id").primaryKey({autoIncrement:true}), patternId:integer("pattern_id").notNull().references(()=>shiftPatterns.id), guardId:integer("guard_id").notNull().references(()=>guards.id), postId:integer("post_id").references(()=>posts.id), vehicleId:integer("vehicle_id").references(()=>vehicles.id), role:text("role",{enum:["guard","driver","patrol","third"]}).notNull(), ...audit,
},t=>[uniqueIndex("idx_pattern_slots_pattern_guard").on(t.patternId,t.guardId)]);
export const schedulePatterns = sqliteTable("schedule_patterns", {
 id:integer("id").primaryKey({autoIncrement:true}), scheduleId:integer("schedule_id").notNull().references(()=>schedules.id), dayPatternId:integer("day_pattern_id").notNull().references(()=>shiftPatterns.id), nightPatternId:integer("night_pattern_id").notNull().references(()=>shiftPatterns.id), appliedAt:text("applied_at").notNull().default("CURRENT_TIMESTAMP"),
},t=>[uniqueIndex("idx_schedule_patterns_schedule").on(t.scheduleId)]);
export const operationalNotices = sqliteTable("operational_notices", {
 id:integer("id").primaryKey({autoIncrement:true}), effectiveDate:text("effective_date").notNull(), title:text("title").notNull(), details:text("details"),
 status:text("status",{enum:["pending","acknowledged"]}).notNull().default("pending"), acknowledgedAt:text("acknowledged_at"), ...audit,
});
export const auditEvents = sqliteTable("audit_events", {
 id:integer("id").primaryKey({autoIncrement:true}), action:text("action").notNull(), entityType:text("entity_type").notNull(), entityId:text("entity_id"), summary:text("summary").notNull(),
 beforeJson:text("before_json"), afterJson:text("after_json"), actorId:text("actor_id").notNull(), actorEmail:text("actor_email").notNull(), actorName:text("actor_name").notNull(),
 undoable:integer("undoable",{mode:"boolean"}).notNull().default(false), undoneAt:text("undone_at"), undoneById:text("undone_by_id"), undoneByEmail:text("undone_by_email"), createdAt:text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
