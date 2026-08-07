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
  postId:integer("post_id").references(()=>posts.id), vehicleId:integer("vehicle_id").references(()=>vehicles.id), shift:text("shift").notNull(), role:text("role",{enum:["guard","driver","patrol","third"]}).notNull().default("guard"), startsAt:text("starts_at").notNull(), endsAt:text("ends_at").notNull(), status:text("status",{enum:["normal","overtime","time_bank","swap"]}).notNull().default("normal"), requestRef:text("request_ref"), ...audit,
},t=>[uniqueIndex("idx_assignments_schedule_guard_time").on(t.scheduleId,t.guardId,t.startsAt)]);
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
