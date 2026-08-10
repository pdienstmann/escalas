import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
export const scheduleResourceExclusions = sqliteTable("schedule_resource_exclusions", {
  id:integer("id").primaryKey({autoIncrement:true}),
  scheduleId:integer("schedule_id").notNull().references(()=>schedules.id),
  resourceKind:text("resource_kind",{enum:["post","vehicle"]}).notNull(),
  resourceId:integer("resource_id").notNull(),
  reason:text("reason"),
  createdAt:text("created_at").notNull().default("CURRENT_TIMESTAMP"),
},t=>[uniqueIndex("idx_schedule_resource_exclusion").on(t.scheduleId,t.resourceKind,t.resourceId)]);
export const assignments = sqliteTable("assignments", {
  id:integer("id").primaryKey({autoIncrement:true}), scheduleId:integer("schedule_id").notNull().references(()=>schedules.id), guardId:integer("guard_id").notNull().references(()=>guards.id),
  postId:integer("post_id").references(()=>posts.id), vehicleId:integer("vehicle_id").references(()=>vehicles.id), shift:text("shift").notNull(), role:text("role",{enum:["guard","driver","patrol","third"]}).notNull().default("guard"), startsAt:text("starts_at").notNull(), endsAt:text("ends_at").notNull(), regularEndsAt:text("regular_ends_at"), breakStartsAt:text("break_starts_at"), breakEndsAt:text("break_ends_at"), workKind:text("work_kind").notNull().default("shift"), status:text("status",{enum:["normal","overtime","time_bank","swap"]}).notNull().default("normal"), requestRef:text("request_ref"), isReassigned:integer("is_reassigned",{mode:"boolean"}).notNull().default(false), reassignmentNote:text("reassignment_note"), ...audit,
},t=>[uniqueIndex("idx_assignments_schedule_guard_time").on(t.scheduleId,t.guardId,t.startsAt)]);
export const overtimeEntries = sqliteTable("overtime_entries", {
  id:integer("id").primaryKey({autoIncrement:true}),
  assignmentId:integer("assignment_id").references(()=>assignments.id),
  guardId:integer("guard_id").notNull().references(()=>guards.id),
  serviceDate:text("service_date").notNull(),
  startsAt:text("starts_at").notNull(),
  endsAt:text("ends_at").notNull(),
  plannedMinutes:integer("planned_minutes").notNull(),
  confirmedMinutes:integer("confirmed_minutes"),
  status:text("status",{enum:["pending","confirmed","partial","not_performed","cancelled"]}).notNull().default("pending"),
  source:text("source",{enum:["schedule","manual","adjustment"]}).notNull().default("schedule"),
  location:text("location"),requestRef:text("request_ref"),notes:text("notes"),confirmedAt:text("confirmed_at"),...audit,
},t=>[
  uniqueIndex("idx_overtime_entries_assignment").on(t.assignmentId),
  index("idx_overtime_entries_guard_date").on(t.guardId,t.serviceDate),
  index("idx_overtime_entries_status_date").on(t.status,t.serviceDate),
]);
export const overtimeMonthClosures = sqliteTable("overtime_month_closures", {
  month:text("month").primaryKey(),
  status:text("status",{enum:["open","closed"]}).notNull().default("open"),
  closedAt:text("closed_at"),closureNote:text("closure_note"),reopenedAt:text("reopened_at"),reopenReason:text("reopen_reason"),
  updatedAt:text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
},t=>[index("idx_overtime_month_closures_status").on(t.status)]);
export const weeklySlots = sqliteTable("weekly_slots", {id:integer("id").primaryKey({autoIncrement:true}),guardId:integer("guard_id").notNull().references(()=>guards.id),weekdays:text("weekdays").notNull().default("1,2,3,4,5"),postId:integer("post_id").references(()=>posts.id),vehicleId:integer("vehicle_id").references(()=>vehicles.id),role:text("role").notNull().default("guard"),startsAt:text("starts_at").notNull().default("08:00"),breakStart:text("break_start"),breakEnd:text("break_end"),regularEnd:text("regular_end").notNull().default("17:00"),overtimeEnd:text("overtime_end"),active:integer("active",{mode:"boolean"}).notNull().default(true),...audit},t=>[uniqueIndex("idx_weekly_slots_guard").on(t.guardId)]);
export const vehicleOutages = sqliteTable("vehicle_outages", {id:integer("id").primaryKey({autoIncrement:true}),vehicleId:integer("vehicle_id").notNull().references(()=>vehicles.id),startsOn:text("starts_on").notNull(),endsOn:text("ends_on"),reason:text("reason"),active:integer("active",{mode:"boolean"}).notNull().default(true),...audit});
export const vehicleReturnReconciliations = sqliteTable("vehicle_return_reconciliations", {
  id:integer("id").primaryKey({autoIncrement:true}),
  outageId:integer("outage_id").notNull().references(()=>vehicleOutages.id),
  vehicleId:integer("vehicle_id").notNull().references(()=>vehicles.id),
  scheduleId:integer("schedule_id").notNull().references(()=>schedules.id),
  returnOn:text("return_on").notNull(),
  status:text("status",{enum:["pending","restored","shown","kept"]}).notNull().default("pending"),
  linkedAssignments:integer("linked_assignments").notNull().default(0),
  ...audit,
},t=>[
  uniqueIndex("idx_vehicle_return_schedule").on(t.outageId,t.scheduleId),
  index("idx_vehicle_return_pending").on(t.scheduleId,t.vehicleId,t.status),
]);
export const scheduleSections=sqliteTable("schedule_sections",{sectionKey:text("section_key").primaryKey(),label:text("label").notNull(),sortOrder:integer("sort_order").notNull().default(0),updatedAt:text("updated_at").notNull().default("CURRENT_TIMESTAMP")});
export const movements = sqliteTable("movements", {
  id:integer("id").primaryKey({autoIncrement:true}), guardId:integer("guard_id").notNull().references(()=>guards.id), type:text("type",{enum:["day_off","vacation","course","medical_leave","technical_reserve","time_bank","swap"]}).notNull(), startsAt:text("starts_at").notNull(), endsAt:text("ends_at").notNull(), requestRef:text("request_ref"), notes:text("notes"), status:text("status",{enum:["pending","approved","rejected"]}).notNull().default("approved"), ...audit,
});
export const serviceAdjustments = sqliteTable("service_adjustments", {
  id:integer("id").primaryKey({autoIncrement:true}),
  kind:text("kind").notNull(),
  subtype:text("subtype").notNull(),
  guardId:integer("guard_id").notNull().references(()=>guards.id),
  counterpartGuardId:integer("counterpart_guard_id").references(()=>guards.id),
  serviceDate:text("service_date").notNull(),
  startsAt:text("starts_at").notNull(),
  endsAt:text("ends_at").notNull(),
  requestRef:text("request_ref"),notes:text("notes"),
  status:text("status").notNull().default("active"),snapshotJson:text("snapshot_json"),
  ...audit,
});
export const leaveCampaigns = sqliteTable("leave_campaigns", {
  id:integer("id").primaryKey({autoIncrement:true}), month:text("month").notNull().unique(), title:text("title").notNull(), weekdayQuota:integer("weekday_quota").notNull().default(1), weekendQuota:integer("weekend_quota").notNull().default(1), status:text("status",{enum:["draft","open","closed","published"]}).notNull().default("draft"), accessCode:text("access_code").notNull(), ...audit,
});
export const leaveDayLimits = sqliteTable("leave_day_limits", {
 id:integer("id").primaryKey({autoIncrement:true}), campaignId:integer("campaign_id").notNull().references(()=>leaveCampaigns.id), date:text("date").notNull(), platoon:text("platoon"), capacity:integer("capacity").notNull(), ...audit,
},t=>[uniqueIndex("idx_leave_limits_campaign_date_platoon").on(t.campaignId,t.date,t.platoon)]);
export const leaveChoices = sqliteTable("leave_choices", {
 id:integer("id").primaryKey({autoIncrement:true}), campaignId:integer("campaign_id").notNull().references(()=>leaveCampaigns.id), guardId:integer("guard_id").notNull().references(()=>guards.id), date:text("date").notNull(), category:text("category",{enum:["weekday","weekend"]}).notNull(), status:text("status",{enum:["confirmed","waitlist","cancelled"]}).notNull(), position:integer("position"), ...audit,
},t=>[uniqueIndex("idx_leave_choices_campaign_guard_date").on(t.campaignId,t.guardId,t.date)]);
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
export const operations = sqliteTable("operations", {
 id:integer("id").primaryKey({autoIncrement:true}),scheduleId:integer("schedule_id").notNull().references(()=>schedules.id),title:text("title").notNull(),startsAt:text("starts_at").notNull(),endsAt:text("ends_at").notNull(),location:text("location"),commander:text("commander"),reference:text("reference"),notes:text("notes"),requestedGuards:integer("requested_guards").notNull().default(0),status:text("status",{enum:["draft","confirmed","cancelled"]}).notNull().default("draft"),...audit,
},t=>[index("idx_operations_schedule_time").on(t.scheduleId,t.startsAt,t.endsAt)]);
export const operationVehicles = sqliteTable("operation_vehicles", {
 id:integer("id").primaryKey({autoIncrement:true}),operationId:integer("operation_id").notNull().references(()=>operations.id,{onDelete:"cascade"}),vehicleId:integer("vehicle_id").notNull().references(()=>vehicles.id),sortOrder:integer("sort_order").notNull().default(0),...audit,
},t=>[uniqueIndex("idx_operation_vehicle_unique").on(t.operationId,t.vehicleId),index("idx_operation_vehicles_vehicle").on(t.vehicleId,t.operationId)]);
export const operationSlots = sqliteTable("operation_slots", {
 id:integer("id").primaryKey({autoIncrement:true}),operationId:integer("operation_id").notNull().references(()=>operations.id,{onDelete:"cascade"}),operationVehicleId:integer("operation_vehicle_id").references(()=>operationVehicles.id,{onDelete:"cascade"}),role:text("role",{enum:["driver","patrol","third","guard"]}).notNull().default("guard"),position:integer("position").notNull().default(0),guardId:integer("guard_id").references(()=>guards.id),sourceType:text("source_type",{enum:["pending","available","overtime","extension","redeployment"]}).notNull().default("pending"),originAssignmentId:integer("origin_assignment_id").references(()=>assignments.id),...audit,
},t=>[index("idx_operation_slots_operation").on(t.operationId,t.operationVehicleId,t.position),index("idx_operation_slots_guard").on(t.guardId,t.operationId)]);
export const operationSlotOrigins = sqliteTable("operation_slot_origins", {
 id:integer("id").primaryKey({autoIncrement:true}),slotId:integer("slot_id").notNull().references(()=>operationSlots.id,{onDelete:"cascade"}),assignmentId:integer("assignment_id").notNull().references(()=>assignments.id),postId:integer("post_id").references(()=>posts.id),vehicleId:integer("vehicle_id").references(()=>vehicles.id),role:text("role").notNull(),wasReassigned:integer("was_reassigned",{mode:"boolean"}).notNull().default(false),reassignmentNote:text("reassignment_note"),createdAt:text("created_at").notNull().default("CURRENT_TIMESTAMP"),
},t=>[uniqueIndex("idx_operation_slot_origin_unique").on(t.slotId,t.assignmentId),index("idx_operation_slot_origins_assignment").on(t.assignmentId,t.slotId)]);
export const auditEvents = sqliteTable("audit_events", {
 id:integer("id").primaryKey({autoIncrement:true}), action:text("action").notNull(), entityType:text("entity_type").notNull(), entityId:text("entity_id"), summary:text("summary").notNull(),
 beforeJson:text("before_json"), afterJson:text("after_json"), actorId:text("actor_id").notNull(), actorEmail:text("actor_email").notNull(), actorName:text("actor_name").notNull(),
 undoable:integer("undoable",{mode:"boolean"}).notNull().default(false), undoneAt:text("undone_at"), undoneById:text("undone_by_id"), undoneByEmail:text("undone_by_email"), createdAt:text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
