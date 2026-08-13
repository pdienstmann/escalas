import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  formatScheduleDate,
  isScheduleDate,
  resolveScheduleDate,
  todayScheduleDate,
  withScheduleDate,
} from "../lib/schedule-date.ts";
import { orderScheduleResources } from "../lib/schedule-sections.ts";
import { assignmentOverlapsShift, coveredOperationalShifts, formatHoursDuration, fullPeriodWindow, fullPeriodShifts, mapAssignmentSegmentToShift, splitExtensionWindow } from "../lib/shift-rules.ts";
import { rankGuardSuggestions, describeReasons } from "../lib/suggest-gm.ts";
import { groupRedeploymentAssignments, mergeScheduleAssignments } from "../lib/schedule-state.ts";
import { orderAssignmentsInResourceCell, orderedResourceGuardIds } from "../lib/schedule-lanes.ts";
import { suggestionPosition } from "../lib/suggestion-position.ts";
import { compactRequestReference } from "../lib/request-reference.ts";
import { copiedBlockStatus } from "../lib/copy-rules.ts";
import { operationalGroupLabel, operationalGroupOrder, operationalTeamLabel } from "../lib/operational-groups.ts";
import { operationalGroupAnchorShift, operationalGroupDurationHours, operationalGroupInterval, operationalGroupMemberCoversShift, timeAfterHours } from "../lib/operational-group-schedule.ts";
import { normalizeLeaveDisplayName, normalizeLeaveName, preferredLeaveNameMatch } from "../lib/leave-name.ts";

test("operational group workdays can start at any time and always span 12 hours", () => {
  assert.equal(timeAfterHours("13:00", 12), "01:00");
  assert.equal(timeAfterHours("22:30", 12), "10:30");
  assert.equal(operationalGroupDurationHours("13:00", "01:00"), 12);
  assert.equal(operationalGroupAnchorShift("13:00"), "3");
  assert.deepEqual(operationalGroupInterval("2026-08-12", "day", "13:00", "01:00"), {
    start: "2026-08-12T13:00",
    end: "2026-08-13T01:00",
  });
  const member = { pattern_period: "day", starts_at: "13:00", ends_at: "01:00" };
  assert.equal(operationalGroupMemberCoversShift(member, "2026-08-12", "2"), false);
  assert.equal(operationalGroupMemberCoversShift(member, "2026-08-12", "3"), true);
  assert.equal(operationalGroupMemberCoversShift(member, "2026-08-12", "4"), true);
  assert.equal(operationalGroupMemberCoversShift(member, "2026-08-12", "1"), false);
  assert.deepEqual(operationalGroupInterval("2026-08-12", "night", "01:00", "13:00"), {
    start: "2026-08-13T01:00",
    end: "2026-08-13T13:00",
  });
  const lateMember = { pattern_period: "night", starts_at: "22:30", ends_at: "10:30" };
  assert.equal(operationalGroupMemberCoversShift(lateMember, "2026-08-12", "4"), true);
  assert.equal(operationalGroupMemberCoversShift(lateMember, "2026-08-12", "1"), true);
  assert.equal(operationalGroupMemberCoversShift(lateMember, "2026-08-12", "2"), false);
});

test("request references stay compact and visible in the schedule and PDF", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/request-reference.css"), "utf8");
  assert.equal(compactRequestReference("  REQ-123   operação centro  "), "REQ-123 operação centro");
  assert.equal(compactRequestReference("123456789012345678901234567890"), "123456789012345678901234567\u2026");
  assert.match(schedule, /className="request-reference"/);
  assert.match(print, /className="request-reference"/);
  assert.match(styles, /#b21f2d/);
});

test("resolveScheduleDate prefers URL date over storage and today", () => {
  assert.equal(isScheduleDate("2026-08-12"), true);
  assert.equal(isScheduleDate("2026-13-01"), false);
  assert.equal(resolveScheduleDate("2026-08-20"), "2026-08-20");
  assert.equal(resolveScheduleDate("invalid", "2026-08-08"), "2026-08-08");
  assert.match(todayScheduleDate(new Date("2026-08-08T15:00:00")), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayScheduleDate(new Date("2026-08-09T02:36:57Z")), "2026-08-08");
  assert.equal(formatScheduleDate("2026-08-12"), "12/08/2026");
});

test("withScheduleDate preserves path and injects date query", () => {
  assert.equal(withScheduleDate("/padroes", "2026-08-15"), "/padroes?date=2026-08-15");
  assert.equal(
    withScheduleDate("/validacao?foo=1", "2026-08-15"),
    "/validacao?foo=1&date=2026-08-15",
  );
  assert.equal(withScheduleDate("/impressao", "bad"), "/impressao");
});

test("the More navigation stays visible above the responsive tab bar", () => {
  const nav = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(nav, /<details className=\{`nav-more/);
  assert.match(nav, /moreGroups\.map/);
  assert.match(nav, /activeMoreItem/);
  assert.match(nav, /aria-label=\{activeMoreItem/);
  assert.match(styles, /\.tabs\{position:relative;z-index:60;overflow:visible!important\}/);
  assert.match(styles, /\.nav-more\[open\]\{z-index:1000\}/);
  assert.match(styles, /\.nav-more\.has-active summary/);
  assert.match(styles, /flex-wrap:wrap/);
  assert.match(styles, /max-height:calc\(100dvh - 130px\)/);
});

test("operational navigation is grouped on desktop and uses a compact mobile bar", () => {
  const nav = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const link = readFileSync(resolve("app/full-page-link.tsx"), "utf8");
  const styles = readFileSync(resolve("app/interaction-system.css"), "utf8");
  assert.match(nav, /Gestão do efetivo/);
  assert.match(nav, /Preparação da escala/);
  assert.match(nav, /Conferência/);
  assert.match(nav, /mobile-module-nav/);
  assert.match(link, /useRouter/);
  assert.match(link, /router\.push\(href\)/);
  assert.match(styles, /grid-template-columns: repeat\(5/);
  assert.match(styles, /body \{ padding-bottom:/);
});

test("large movement lists paginate remotely without mounting every record at once", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/interaction-system.css"), "utf8");
  assert.match(dashboard, /const pageSize = 50/);
  assert.match(dashboard, /movementPage: String\(page\)/);
  assert.match(dashboard, /movementQuery/);
  assert.match(dashboard, /pageItems = visible/);
  assert.match(dashboard, /movement-pagination/);
  assert.match(api, /movementPageSize/);
  assert.match(api, /movementWhereSql/);
  assert.match(api, /LIMIT \? OFFSET \?/);
  assert.match(styles, /\.movement-pagination/);
});

test("audit history uses the same server pagination and date-scoped filters", () => {
  const dashboard = readFileSync(resolve("app/history-dashboard.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/history/route.ts"), "utf8");
  const dialog = readFileSync(resolve("app/app-dialog.tsx"), "utf8");
  assert.match(dashboard, /useModuleUiState\("historico", date/);
  assert.match(dashboard, /pageSize: "40"/);
  assert.match(dashboard, /history-pagination/);
  assert.match(api, /LIMIT \? OFFSET \?/);
  assert.match(api, /meta:\{page,pageSize,total/);
  assert.match(dialog, /keepFocusInside/);
});

test("shared dialogs and saved module filters work across the operational pages", () => {
  const dialog = readFileSync(resolve("app/app-dialog.tsx"), "utf8");
  const state = readFileSync(resolve("app/use-module-ui-state.ts"), "utf8");
  const operations = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  const patterns = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const management = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(state, /gmnh:ui:/);
  assert.match(operations, /<AppDialog className="operation-dialog-backdrop"/);
  assert.match(patterns, /<AppDialog className="pattern-preview-backdrop"/);
  assert.match(management, /useModuleUiState\("movimentos", date/);
});

test("management modules request only their own administrative dataset", () => {
  const client = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  assert.match(client, /view=\$\{mode\}/);
  assert.match(client, /escala-admin-cache:v2:/);
  assert.match(client, /\$\{adminCachePrefix\}\$\{mode\}:\$\{date\}/);
  assert.match(api, /allowedViews = new Set\(\["full", "cadastros", "viaturas", "folgas", "movimentos", "ajustes"\]\)/);
  assert.match(api, /needs\("cadastros", "folgas", "movimentos", "ajustes"\)/);
  assert.match(api, /needs\("viaturas"\) \? env\.DB\.prepare/);
  assert.match(api, /needs\("folgas"\) \? buildLeaveOverview/);
  assert.match(api, /needs\("cadastros"\) \? ensureSections\(\)/);
});

test("monthly planning sends compact days and loads only the selected detail", () => {
  const api = readFileSync(resolve("app/api/planning/route.ts"), "utf8");
  const groups = readFileSync(resolve("lib/operational-groups-db.ts"), "utf8");
  const patterns = readFileSync(resolve("lib/pattern-engine.ts"), "utf8");
  const planning = readFileSync(resolve("app/monthly-planning.tsx"), "utf8");
  const print = readFileSync(resolve("app/monthly-planning-print.tsx"), "utf8");
  const styles = readFileSync(resolve("app/monthly-planning.css"), "utf8");
  assert.match(api, /requestedDetail === "all"/);
  assert.match(api, /day: \{ \.\.\.\(day\.day as Row\), sections: \[\] \}/);
  assert.match(api, /detailDate: detailDate === "all" \? null : detailDate/);
  assert.match(planning, /const loadSequence = useRef\(0\)/);
  assert.match(planning, /sequence !== loadSequence\.current/);
  assert.match(planning, /data\?\.detailDate !== date/);
  assert.match(planning, /planning-detail-loading/);
  assert.match(print, /detail=all/);
  assert.match(styles, /\.planning-detail-loading/);
  assert.match(api, /await env\.DB\.batch<Row>\(/);
  assert.match(api, /"server-timing"/);
  assert.match(groups, /let operationalGroupsReady: Promise<void> \| null = null/);
  assert.match(groups, /operationalGroupsReady = null/);
  assert.match(groups, /configured_count/);
  assert.match(patterns, /let patternsReady: Promise<void> \| null = null/);
  assert.match(patterns, /patternsReady = null/);
});

test("every operational module shares date-preserving navigation with discreet feedback", () => {
  const navigation = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const management = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const transition = readFileSync(resolve("app/full-page-link.tsx"), "utf8");
  const styles = readFileSync(resolve("app/unified-navigation.css"), "utf8");
  assert.match(navigation, /\/validacao.*Validar \/ publicar/);
  assert.match(management, /<ScheduleNav date=\{date\} active=\{active\}/);
  for (const file of ["overtime-dashboard", "patterns-dashboard", "notices-dashboard", "history-dashboard", "validate-schedule"]) {
    const source = readFileSync(resolve(`app/${file}.tsx`), "utf8");
    assert.match(source, /<ScheduleNav date=\{date\}/);
  }
  assert.match(transition, /Abrindo \$\{destinationName\(href\)\}/);
  assert.match(styles, /inset: auto 14px 14px auto/);
  assert.doesNotMatch(styles, /inset:\s*0/);
});

test("orderScheduleResources uses shared section order for schedule and PDF", () => {
  const ordered = orderScheduleResources(
    [
      { id: 1, prefix: "VTR 1", zone: "Zona A" },
      { id: 2, prefix: "VTR 2", zone: "Zona B" },
    ],
    [
      { id: 10, name: "Sala", group_name: "SEDE DA GM" },
      { id: 11, name: "RodoviÃ¡ria", group_name: "POSTOS DIVERSOS" },
    ],
    [
      { section_key: "POST:POSTOS DIVERSOS", label: "POSTOS DIVERSOS", sort_order: 1 },
      { section_key: "VEHICLES", label: "VIATURAS E ZONAS", sort_order: 2 },
      { section_key: "POST:SEDE DA GM", label: "SEDE DA GM", sort_order: 3 },
    ],
  );

  assert.deepEqual(
    ordered.map((item) => `${item.kind}:${item.r.id}:${item.section}`),
    [
      "post:11:POSTOS DIVERSOS",
      "vehicle:1:VIATURAS E ZONAS",
      "vehicle:2:VIATURAS E ZONAS",
      "post:10:SEDE DA GM",
    ],
  );
});

test("operational groups stay compact and recognizable in the schedule", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  const theme = readFileSync(resolve("app/spreadsheet-theme.css"), "utf8");
  assert.equal(operationalGroupLabel({ name: "Base GESCOM", group_name: "POSTOS DIVERSOS" }), "GESCOM");
  assert.equal(operationalGroupLabel({ name: "Canil Municipal" }), "CANIL");
  assert.equal(operationalTeamLabel({ name: "Motos Alfa" }), "ALFA");
  assert.equal(operationalGroupOrder({ name: "ROMU" }) < operationalGroupOrder({ name: "Outro" }), true);
  assert.match(schedule, /className="operational-group-heading"/);
  assert.match(schedule, /resource-unit-tags/);
  assert.match(density, /\.app\.compact \.schedule tbody tr\.post-row/);
  assert.match(density, /\.operational-group-heading/);
  assert.match(schedule, /className="operational-team-heading"/);
  assert.match(schedule, /previousOperationalTeam !== operationalTeam/);
  assert.match(theme, /\.operational-team-heading/);
});

test("operational groups are editable and can classify existing resources", () => {
  const admin = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const catalog = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(admin, /operational_group_create/);
  assert.match(admin, /operational_group_update/);
  assert.match(admin, /operational_group_member_set/);
  assert.match(admin, /DELETE FROM operational_group_members/);
  assert.match(catalog, /Grupamentos e equipes/);
  assert.match(catalog, /Vincular recurso/);
  assert.match(readFileSync(resolve("app/live-schedule.tsx"), "utf8"), /Filtrar por grupamento operacional/);
});

test("section headers expose resource counts without removing their inline actions", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const theme = readFileSync(resolve("app/spreadsheet-theme.css"), "utf8");
  assert.match(schedule, /const sectionResourceCounts = useMemo/);
  assert.match(schedule, /sectionResourceCount=\{sectionResourceCounts\.get\(displaySection\) \|\| 0\}/);
  assert.match(schedule, /className="section-heading-summary"/);
  assert.match(schedule, /aria-expanded=\{!collapsed\}/);
  assert.match(theme, /\.section-toggle-label/);
  assert.match(theme, /\.section-heading-summary/);
});

test("worker marks dynamic HTML as uncached so deploys cannot mix old pages with new assets", () => {
  const worker = readFileSync(resolve("worker/index.ts"), "utf8");
  assert.match(worker, /content-type.*text\/html/);
  assert.match(worker, /headers\.set\("cache-control", "no-store, max-age=0"\)/);
  assert.match(worker, /headers\.set\("cdn-cache-control", "no-store"\)/);
});

test("concurrent first opens can apply one pattern without duplicate-assignment failures", () => {
  const engine = readFileSync(resolve("lib/pattern-engine.ts"), "utf8");
  assert.match(engine, /INSERT OR IGNORE INTO assignments \(schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status\)/);
});

test("management reads reuse structural D1 initialization inside a warm worker", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  assert.match(api, /let adminInfrastructurePromise: Promise<void> \| null = null/);
  assert.match(api, /await Promise\.all\(\[ensureAdminInfrastructure\(\), needs\("cadastros"\) \? ensureSections\(\) : Promise\.resolve\(\)\]\)/);
  assert.match(api, /adminInfrastructurePromise = null/);
});

test("monthly planning accepts a direct month link and large leave lists render progressively", () => {
  const page = readFileSync(resolve("app/planejamento/page.tsx"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(page, /params\.month/);
  assert.match(page, /`\$\{params\.month\}-01`/);
  assert.match(dashboard, /filteredItems\.slice\(0, visibleCount\)/);
  assert.match(dashboard, /Mostrar mais 50/);
  assert.match(dashboard, /☀ Diurno/);
  assert.match(dashboard, /☾ Noturno/);
});

test("redeployment visibility rule keeps crew when vehicle leaves active set", () => {
  const blocked = new Set([99]);
  const visibleVehicleIds = new Set([1]);
  const visiblePostIds = new Set([10]);
  const awaitingRedeploy = (a) => {
    if (blocked.has(Number(a.guard_id))) return false;
    const hasVehicle = Boolean(a.vehicle_id);
    const hasPost = Boolean(a.post_id);
    if (!hasVehicle && !hasPost) return true;
    if (hasVehicle && !visibleVehicleIds.has(Number(a.vehicle_id))) return true;
    if (hasPost && !visiblePostIds.has(Number(a.post_id))) return true;
    return false;
  };

  const assignments = [
    { id: 1, guard_id: 1, vehicle_id: 1, post_id: null },
    { id: 2, guard_id: 2, vehicle_id: 9, post_id: null },
    { id: 3, guard_id: 3, vehicle_id: null, post_id: null },
    { id: 4, guard_id: 99, vehicle_id: 9, post_id: null },
    { id: 5, guard_id: 5, vehicle_id: null, post_id: 10 },
  ];

  const active = assignments.filter((a) => !blocked.has(Number(a.guard_id)) && !awaitingRedeploy(a));
  const pool = assignments.filter((a) => awaitingRedeploy(a));

  assert.deepEqual(
    active.map((a) => a.id),
    [1, 5],
  );
  assert.deepEqual(
    pool.map((a) => a.id),
    [2, 3],
  );
});


test("fullPeriodWindow covers 07h-19h for day shifts and 19h-07h for night", () => {
  const day = fullPeriodWindow("2026-08-12", "2");
  assert.equal(day.start, "2026-08-12T07:00");
  assert.equal(day.end, "2026-08-12T19:00");
  const night = fullPeriodWindow("2026-08-12", "4");
  assert.equal(night.start, "2026-08-12T19:00");
  assert.equal(night.end, "2026-08-13T07:00");
  assert.deepEqual(fullPeriodShifts("3"), ["2", "3"]);
  assert.deepEqual(fullPeriodShifts("1"), ["4", "1"]);
});

test("cross-turn assignment appears in every operational column it covers", () => {
  const assignment = { shift: "3", starts_at: "2026-08-12T13:00", ends_at: "2026-08-13T01:00" };
  assert.deepEqual(coveredOperationalShifts(assignment, "2026-08-12"), ["3", "4"]);
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "2"), false);
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "1"), false);
});

test("shortened 3rd-turn assignment is not rendered as a 13h-13h card in the 2nd turn", () => {
  const assignment = { shift: "2", starts_at: "2026-08-12T13:00", ends_at: "2026-08-12T16:00" };
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "2"), false);
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "3"), true);
});

test("weekly overtime extension is also visible in the night period", () => {
  const assignment = { shift: "W", starts_at: "2026-08-12T08:00", ends_at: "2026-08-12T23:00" };
  assert.deepEqual(coveredOperationalShifts(assignment, "2026-08-12"), ["2", "3", "4"]);
});

test("overtime shortcut lives inside the GM card and stays distinct from add actions", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(schedule, /className={`live-person-card/);
  assert.match(schedule, /<span aria-hidden="true">◷<\/span>\+HE/);
  assert.doesNotMatch(schedule, />＋ HE depois<\/button>/);
  assert.match(density, /\.live-person-card \.inline-he-extension/);
  assert.match(density, /border-top:2px solid/);
  assert.match(density, /border-bottom:4px solid/);
});

test("regular and operational-group cards share the same in-scope HE shortcut rules", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /function extensionShortcutAvailable\(/);
  assert.match(schedule, /extensionShortcutAvailable\(actionAssignment, shift\.id, date, assignments\)/);
  assert.match(schedule, /extensionShortcutAvailable\(a,s\.id,date,allScheduleAssignments\)/);
  assert.match(schedule, /earlyExtensionShortcutAvailable\(actionAssignment, shift\.id, date\)/);
  assert.doesNotMatch(schedule, /showExtensionShortcut/);
});

test("motorcycles never expose a patrol hole in the daily scale or operations", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const operations = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  const operationsApi = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  assert.match(schedule, /isMotorcycleType\(resource\.type\)[\s\S]*?\? list\.some\(\(assignment\) => !isOvertimeExtensionCell/);
  assert.match(schedule, /Em serviço · condutor definido/);
  assert.match(operations, /Moto recebe somente um condutor/);
  assert.match(operations, /isMotorcycleType\(vehicle\.type\)\?"1 condutor"/);
  assert.match(operationsApi, /requiredVehicleSlots=selectedVehicles\.reduce/);
  assert.match(operationsApi, /if\(!isMotorcycleType\(vehicle\.type\)\)slots\.push/);
  assert.match(print, /motorcycle\?<td>—<\/td>/);
});

test("schedule rows are memoized so shell feedback does not repaint the full matrix", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /<MemoizedRow/);
  assert.match(schedule, /const MemoizedRow = memo\(Row/);
  assert.match(schedule, /previous\.assignmentIndex === next\.assignmentIndex/);
  assert.match(schedule, /sameNumberList\(previous\.recentAssignmentIds, next\.recentAssignmentIds\)/);
});

test("the operational toolbar can jump directly to a visible section", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /className="section-jump"/);
  assert.match(schedule, /function jumpToSection\(section: string\)/);
  assert.match(schedule, /wrapper\.scrollBy\(\{ top:/);
  assert.match(schedule, /onSectionRef=\{/);
  assert.match(usability, /\.section-jump select/);
});

test("the pending shortcut keeps holes and the redeployment pool together", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /if \(target === "pending"\) setView\("holes"\)/);
  assert.match(schedule, /const showRedeploy = view === "all" \|\| view === "holes" \|\| view === "redeploy"/);
  assert.match(schedule, /redeploymentExpanded\|\|view==="redeploy"\|\|view==="holes"/);
});

test("schedule restores both page and horizontal grid position per date", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /gmnh:grid-scroll/);
  assert.match(schedule, /wrapper\.scrollLeft=Number\(savedGrid\.left\|\|0\)/);
  assert.match(schedule, /wrapper\.scrollTop=Number\(savedGrid\.top\|\|0\)/);
  assert.match(schedule, /wrapper\?\.addEventListener\("scroll",rememberGrid/);
});

test("selected GM cards use drag and drop instead of a destination picker", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.doesNotMatch(schedule, /quick-move-trigger|Mover local/);
  assert.doesNotMatch(schedule, /moveChoices|inline-move-picker/);
  assert.match(schedule, /dataTransfer\.setData\("text\/assignment", String\(a\.id\)\)/);
  assert.match(schedule, /void onMove\(assignment, kind, resource, shift, sourceShift, targetAssignmentId\)/);
  assert.match(schedule, /function canDropOnCard\(target: Rec\)/);
  assert.match(schedule, /draggingAssignmentId===Number\(a\.id\)\?"dragging-source"/);
  assert.match(schedule, /targetAssignmentId && targetAssignmentId === id/);
  assert.match(schedule, /drag-context-hint/);
  assert.match(schedule, /function linkedRegularJourney/);
  assert.match(schedule, /text\/assignment-group/);
  assert.match(schedule, /setAssignmentDragPreview/);
  assert.match(schedule, /Movimentação cancelada/);
  assert.match(schedule, /if \(alreadyHere\)/);
  assert.match(schedule, /onMove\(firstAssignment, kind, resource, shift, shift, targetAssignmentId\)/);
});

test("selected GM cards expose one compact contextual action menu", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/contextual-actions.css"), "utf8");
  assert.match(schedule, /className="cell-quick-head"/);
  assert.match(schedule, /> Ajustar<\/button>/);
  assert.match(schedule, /> Mais detalhes<\/button>/);
  assert.match(schedule, /> Remover horário<\/button>/);
  assert.match(schedule, /className="cell-more-actions"/);
  assert.match(schedule, /<summary>Mais ações<\/summary>/);
  assert.match(schedule, /Para mover ou alinhar, arraste o quadradinho diretamente/);
  assert.doesNotMatch(schedule, /> Alterar \/ mover<\/button>/);
  assert.doesNotMatch(schedule, /className="inline-move-tools"/);
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
});

test("selected regular GM cards use drop-on-card to choose lane position", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.doesNotMatch(schedule, /quick-position-trigger|Ajustar posição/);
  assert.doesNotMatch(schedule, /inline-position-picker|Colocar no final/);
  assert.match(schedule, /targetAssignmentId\?: number/);
  assert.match(schedule, /if\(canDropOnCard\(a\)\)drop\(event,s\.id,Number\(a\.id\)\)/);
  assert.match(schedule, /const sameShift = sourceShift \? sourceShift === shift/);
});

test("dragging a card across quadrants moves only its visible segment and adjusts the clock", () => {
  assert.deepEqual(mapAssignmentSegmentToShift("2026-08-12", "2", "4", "2026-08-12T07:00", "2026-08-12T13:00"), {
    source: { start: "2026-08-12T07:00", end: "2026-08-12T13:00" },
    target: { start: "2026-08-12T19:00", end: "2026-08-13T01:00" },
    remainders: [],
  });
  assert.deepEqual(mapAssignmentSegmentToShift("2026-08-12", "2", "4", "2026-08-12T07:00", "2026-08-12T19:00"), {
    source: { start: "2026-08-12T07:00", end: "2026-08-12T13:00" },
    target: { start: "2026-08-12T19:00", end: "2026-08-13T01:00" },
    remainders: [{ start: "2026-08-12T13:00", end: "2026-08-12T19:00" }],
  });
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  assert.match(schedule, /action: "move_assignment_to_cell"/);
  assert.match(schedule, /sourceShift: sourceShift \|\| assignment\.shift/);
  assert.match(api, /mapAssignmentSegmentToShift/);
  assert.match(api, /Remanejado do \$\{sourceShift\}º para o \$\{targetShift\}º turno/);
});

test("copying a regular block into another quadrant is automatically classified as HE", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  assert.equal(copiedBlockStatus({ status: "normal", work_kind: "weekly" }), "overtime");
  assert.equal(copiedBlockStatus({ status: "overtime", work_kind: "shift" }), "overtime");
  assert.equal(copiedBlockStatus({ status: "time_bank", work_kind: "time_bank_positive" }), "time_bank");
  assert.match(api, /const targetStatus=copiedBlockStatus\(source\)/);
  assert.match(api, /automaticOvertime/);
  assert.match(schedule, /a cópia será marcada como HE/);
});

test("completed cells expose only redeployment and intelligent HE suggestions", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /className="cell-add-member"/);
  assert.match(schedule, /quickAddCandidates\.map/);
  assert.match(schedule, /onQuickAdd\(Number\(guard\.id\), kind, resource, s\.id\)/);
  assert.match(schedule, /serviceAdjustmentBlockedIds/);
  assert.match(schedule, /movements\.some\(\(movement\) => Number\(movement\.guard_id\)/);
  assert.match(schedule, /quickAddAvailableIds\.has\(Number\(guard\.id\)\)/);
  assert.match(schedule, /previous\.movements === next\.movements/);
  assert.match(schedule, /Abrir sugestões inteligentes/);
  assert.match(schedule, /Nenhum GM à disposição neste período/);
  assert.doesNotMatch(schedule, /Livre no turno/);
  assert.doesNotMatch(schedule, /className="quick-add-advanced"/);
  assert.match(usability, /\.quick-add-picker/);
});

test("holes open one contextual picker with the three best redeployment and HE options", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const dialog = readFileSync(resolve("app/hole-suggest-box.tsx"), "utf8");
  const styles = readFileSync(resolve("app/workforce.css"), "utf8");
  assert.match(schedule, /className="live-hole"[\s\S]*aria-haspopup="dialog"[\s\S]*onHolePick\(kind, resource, s\.id, event\)/);
  assert.match(dialog, /Remanejar alguém deste dia/);
  assert.match(dialog, /Chamar em HE/);
  assert.match(dialog, /availableCandidates\.slice\(0, 3\)/);
  assert.match(dialog, /filteredOvertime\.slice\(0, 3\)/);
  assert.match(dialog, /Ver todas \(\$\{activeTotal\}\)/);
  assert.match(styles, /\.hole-suggest-modes/);
  assert.match(styles, /\.hole-suggest-more/);
  assert.match(schedule, /action: "redeploy_group"/);
  assert.match(schedule, /poolGroup\.map\(\(assignment\) => Number\(assignment\.id\)\)/);
  assert.match(schedule, /status: hasOtherBlock \? "overtime" : "normal"/);
  assert.match(api, /if \(b\.action === "redeploy_group"\)/);
});

test("segment removal remains in the compact action menu instead of occupying the card", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/segment-remove.css"), "utf8");
  assert.doesNotMatch(schedule, /className="live-person-remove"/);
  assert.match(schedule, /className="danger" onClick=\{\(\)=>onQuickDelete\(a,s\.id\)\}/);
  assert.match(schedule, /action: "delete_shift_segment"/);
  assert.match(api, /if \(b\.action === "delete_shift_segment"\)/);
  assert.match(api, /UPDATE assignments SET starts_at=\?,ends_at=\?/);
  assert.match(api, /INSERT INTO assignments \(schedule_id,guard_id,post_id,vehicle_id/);
  assert.match(styles, /\.live-person-card \.live-person-remove/);
  assert.match(styles, /@media print\{\.live-person-card \.live-person-remove\{display:none/);
});

test("schedule offers compact and detailed views without losing operational card data", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(schedule, /type ScheduleDensity = "compact" \| "detailed"/);
  assert.match(schedule, /Nível de detalhes da escala/);
  assert.match(schedule, /setDensity\("compact"\)/);
  assert.match(schedule, /setDensity\("detailed"\)/);
  assert.match(schedule, /compactRequestReference\(a\.request_ref\)/);
  assert.match(density, /\.app\.detailed \.live-person-card \.live-person/);
  assert.match(density, /\.assignment-drag-preview/);
  assert.match(density, /INSERIR AQUI/);
});

test("formatHoursDuration renders 2h and 2h30 without decimals", () => {
  assert.equal(formatHoursDuration(2), "2h");
  assert.equal(formatHoursDuration(2.5), "2h30");
  assert.equal(formatHoursDuration(0), "0h");
  assert.equal(formatHoursDuration(0.25), "0h15");
  assert.equal(formatHoursDuration(6), "6h");
});

test("splitExtensionWindow keeps regular duty and overtime in independent blocks", () => {
  assert.deepEqual(
    splitExtensionWindow("2026-08-12T13:00", "2026-08-12T19:00", "2026-08-12T19:00", "2026-08-13T01:00"),
    {
      regular: { start: "2026-08-12T13:00", end: "2026-08-12T19:00" },
      extension: { start: "2026-08-12T19:00", end: "2026-08-13T01:00" },
    },
  );
  assert.equal(splitExtensionWindow("2026-08-12T13:00", "2026-08-12T19:00", "2026-08-12T18:00", "2026-08-12T23:00"), null);
});

test("rankGuardSuggestions prioritizes opposite-team GM from same spot", () => {
  const guards = [
    { id: 1, name: "ALMEIDA", registration: "F001", platoon: "D1", base_shift: "12x36 dia", work_regime: "12x36" },
    { id: 2, name: "SANTOS", registration: "F002", platoon: "D2", base_shift: "12x36 dia", work_regime: "12x36" },
    { id: 3, name: "BORGES", registration: "F003", platoon: "N1", base_shift: "12x36 noite", work_regime: "12x36" },
    { id: 4, name: "WEEKLY", registration: "F004", platoon: null, base_shift: "Semanal", work_regime: "weekly" },
  ];
  const ctx = { date: "2026-08-12", shift: "2", postId: null, vehicleId: 1, role: "driver" };
  const assignmentsByGuard = new Map([
    [1, [{ post_id: null, vehicle_id: 1, role: "driver" }]],
    [2, [{ post_id: null, vehicle_id: 1, role: "driver" }]],
    [3, [{ post_id: null, vehicle_id: 2, role: "driver" }]],
  ]);
  const ranked = rankGuardSuggestions(
    guards,
    ctx,
    {
      blockedGuardIds: new Set([3]),
      scheduledGuardIds: new Set(),
      guardHeHours: new Map([[1, 6], [2, 1.5]]),
      guardLastHe: new Map([[1, "2026-08-01"], [2, "2026-08-08"]]),
      guardAssignmentsByGuard: assignmentsByGuard,
      appliedDayCodes: new Set(["D1"]),
      appliedNightCodes: new Set(["N1"]),
    },
  );
  // GM 4 (weekly) filtered out
  assert.equal(ranked.find((g) => g.id === 4), undefined);
  // GM 2 (D2, opposite team, same spot) ranks before GM 1 (D1, today's team).
  assert.ok(ranked[0].id === 2, `expected SANTOS first, got ${ranked[0]?.name}`);
  assert.ok(ranked[0].reasons.includes("opposite_day"));
  const labels = describeReasons(ranked[0].reasons, ranked[0]);
  assert.ok(labels.some((l) => /dia oposto/.test(l)));
  assert.equal(ranked.find((g) => g.id === 1).reasons.includes("opposite_day"), false);
});

test("rankGuardSuggestions orders otherwise equal GMs by the lowest monthly HE", () => {
  const guards = [
    { id: 1, name: "MAIOR HE", registration: "F001", platoon: "D2", base_shift: "12x36 dia", work_regime: "12x36" },
    { id: 2, name: "MENOR HE", registration: "F002", platoon: "D2", base_shift: "12x36 dia", work_regime: "12x36" },
  ];
  const ranked = rankGuardSuggestions(
    guards,
    { date: "2026-08-12", shift: "2", postId: 10, vehicleId: null, role: "guard" },
    {
      guardHeHours: new Map([[1, 24], [2, 4]]),
      appliedDayCodes: new Set(["D1"]),
    },
  );
  assert.equal(ranked[0].id, 2);
  assert.equal(ranked[0].currentHeHours, 4);
});

test("mergeScheduleAssignments updates both shifts without reloading the schedule", () => {
  const current = [
    { id: 1, guard_id: 10, post_id: 1, vehicle_id: null, shift: "2" },
    { id: 2, guard_id: 11, post_id: 2, vehicle_id: null, shift: "4" },
  ];
  const incoming = [
    { id: 3, guard_id: 20, post_id: 1, vehicle_id: null, shift: "2" },
    { id: 4, guard_id: 20, post_id: 1, vehicle_id: null, shift: "3" },
  ];
  const merged = mergeScheduleAssignments(current, [], incoming);
  assert.deepEqual(merged.assignments.map((item) => item.id), [1, 2, 3, 4]);
  assert.equal(merged.availableForRedeployment.length, 0);
});

test("mergeScheduleAssignments removes and preserves redeployment records locally", () => {
  const active = [{ id: 1, guard_id: 10, post_id: 1, vehicle_id: null }];
  const available = [{ id: 2, guard_id: 11, post_id: null, vehicle_id: null }];
  const moved = [{ id: 1, guard_id: 10, post_id: null, vehicle_id: null }];
  const merged = mergeScheduleAssignments(active, available, moved);
  assert.equal(merged.assignments.length, 0);
  assert.deepEqual(merged.availableForRedeployment.map((item) => item.id), [2, 1]);
  const removed = mergeScheduleAssignments(
    merged.assignments,
    merged.availableForRedeployment,
    [],
    2,
  );
  assert.deepEqual(removed.availableForRedeployment.map((item) => item.id), [1]);
});

test("suggestionPosition keeps the suggestion panel inside the available viewport", () => {
  const below = suggestionPosition(
    { top: 100, bottom: 130, left: 900, right: 980 },
    { width: 1100, height: 800 },
  );
  assert.equal(below?.placement, "below");
  assert.ok((below?.left || 0) <= 712);
  assert.ok((below?.top || 0) + (below?.maxHeight || 0) <= 792);

  const above = suggestionPosition(
    { top: 650, bottom: 680, left: 40, right: 120 },
    { width: 1100, height: 720 },
  );
  assert.equal(above?.placement, "above");
  assert.ok((above?.top || 0) >= 8);
  assert.equal(
    suggestionPosition(
      { top: 10, bottom: 40, left: 5, right: 80 },
      { width: 600, height: 700 },
    ),
    null,
  );
});

test("groupRedeploymentAssignments joins both halves of each operational period", () => {
  const grouped = groupRedeploymentAssignments([
    { id: 2, guard_id: 8, guard_name: "ALMEIDA", shift: "3", starts_at: "2026-08-12T13:00", ends_at: "2026-08-12T19:00" },
    { id: 1, guard_id: 8, guard_name: "ALMEIDA", shift: "2", starts_at: "2026-08-12T07:00", ends_at: "2026-08-12T13:00" },
    { id: 4, guard_id: 9, guard_name: "VIEIRA", shift: "1", starts_at: "2026-08-13T01:00", ends_at: "2026-08-13T07:00" },
    { id: 3, guard_id: 9, guard_name: "VIEIRA", shift: "4", starts_at: "2026-08-12T19:00", ends_at: "2026-08-13T01:00" },
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].assignments.map((item) => item.shift), ["2", "3"]);
  assert.deepEqual(grouped[1].assignments.map((item) => item.shift), ["4", "1"]);
});

test("regular GMs keep the same visual order across shifts of one post", () => {
  const shift2 = [
    { id: 1, guard_id: 2, guard_name: "BRUNO", role: "guard", work_kind: "shift" },
    { id: 2, guard_id: 1, guard_name: "ALMEIDA", role: "guard", work_kind: "shift" },
  ];
  const shift3 = [
    { id: 3, guard_id: 1, guard_name: "ALMEIDA", role: "guard", work_kind: "shift" },
    { id: 4, guard_id: 2, guard_name: "BRUNO", role: "guard", work_kind: "shift" },
  ];
  const all = [...shift2, ...shift3];
  assert.deepEqual(orderAssignmentsInResourceCell(shift2, all, "post").map((item) => item.guard_name), ["ALMEIDA", "BRUNO"]);
  assert.deepEqual(orderAssignmentsInResourceCell(shift3, all, "post").map((item) => item.guard_name), ["ALMEIDA", "BRUNO"]);
});

test("independent overtime stays outside regular alignment lanes", () => {
  const regular = { id: 1, guard_id: 2, guard_name: "BRUNO", role: "guard", work_kind: "shift", starts_at: "2026-08-12T13:00" };
  const extension = { id: 2, guard_id: 1, guard_name: "ALMEIDA", role: "guard", work_kind: "overtime_extension", starts_at: "2026-08-12T19:00" };
  const ordered = orderAssignmentsInResourceCell([extension, regular], [extension, regular], "post");
  assert.deepEqual(ordered.map((item) => item.id), [1, 2]);
});

test("saved resource lane order aligns regular GMs and ignores independent overtime", () => {
  const rows = [
    { id: 1, guard_id: 10, guard_name: "ALFA", role: "guard", work_kind: "shift", lane_order: 1 },
    { id: 2, guard_id: 20, guard_name: "BRAVO", role: "guard", work_kind: "shift", lane_order: 0 },
    { id: 3, guard_id: 30, guard_name: "HE", role: "guard", work_kind: "overtime_extension", lane_order: 0 },
  ];
  assert.deepEqual(orderedResourceGuardIds(rows, "post"), [20, 10]);
  assert.deepEqual(orderAssignmentsInResourceCell(rows, rows, "post").map((item) => item.id), [2, 1, 3]);
});

test("partial lane metadata does not drag a remanejamento to the last row", () => {
  const rows = [
    { id: 1, guard_id: 10, guard_name: "ALMEIDA", role: "guard", work_kind: "shift", lane_order: 8 },
    { id: 2, guard_id: 20, guard_name: "BRUNO", role: "guard", work_kind: "shift" },
  ];
  assert.deepEqual(orderAssignmentsInResourceCell(rows, rows, "post").map((item) => item.guard_name), ["ALMEIDA", "BRUNO"]);
});

test("schedule moves reset destination lane metadata and offer HE for a third vehicle member", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(schedule, /const regularCrew = list\.filter/);
  assert.match(schedule, /: "third"/);
  assert.match(schedule, /quickPicker\(true\)/);
  assert.match(api, /lane_order=CASE WHEN COALESCE\(post_id,0\)/);
  assert.match(api, /post_id=\?,vehicle_id=\?,lane_order=NULL/);
  assert.match(density, /has-he-action \.live-person\{padding-right:54px\}/);
  assert.match(density, /inline-he-extension\{top:50%/);
  assert.match(density, /vehicle-row \.resource>div>small/);
  assert.match(density, /\.cell-quick-actions\{display:flex!important/);
});

test("every expanded schedule section ends with an inline resource action", () => {
  const source = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(source, /last && !isCollapsed/);
  assert.match(source, /className="resource-section-footer"/);
  assert.match(source, /initialSection:kind==="post"\?section:undefined/);
  assert.match(source, /selectableResources=kind==="post"&&initialSection/);
});

test("schedule editor distinguishes day and night without changing the PDF", () => {
  const source = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(source, /period-day-head/);
  assert.match(source, /period-night-head period-night-start/);
  assert.match(source, /drop-cell period-\$\{s\.period\}/);
  assert.match(source, /reorder_resource_assignments/);
  assert.match(source, /beforeAssignmentId/);
  assert.match(source, /overtime_extension/);
  assert.match(styles, /@media screen\{/);
  assert.match(styles, /td\.period-day:not\(\.furo\)/);
  assert.match(styles, /td\.period-night:not\(\.furo\)/);
});

test("same-day hole suggestions only expose guards already awaiting redeployment", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const dialog = readFileSync(resolve("app/hole-suggest-box.tsx"), "utf8");
  assert.match(api, /Number\(assignment\.awaiting_redeploy\) !== 1\) continue/);
  assert.doesNotMatch(dialog, /assignedCandidates/);
  assert.doesNotMatch(dialog, /Move o período do GM de outro posto/);
});

test("intelligent HE suggestions are limited to the opposite 12x36 team", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(api, /const automaticPattern = appliedPattern \? null : await resolvePatternCodes/);
  assert.match(api, /const smartRanked = ranked\.filter\(\(candidate\) => candidate\.oppositeTeam\)/);
  assert.match(api, /suggestions: smartRanked\.map/);
  assert.match(schedule, /Somente GMs à disposição ou da equipe oposta/);
  assert.match(schedule, /source: "overtime"/);
});

test("daily operations have an isolated workflow, crew slots and PDF annex", () => {
  const migration = readFileSync(resolve("drizzle/0011_daily_operations.sql"), "utf8");
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `operations`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `operation_slots`/);
  assert.match(api, /sourceType:"available"\|"redeployment"\|"extension"\|"overtime"/);
  assert.match(api, /Uma das viaturas ficou indisponível ou já foi reservada/);
  assert.match(dashboard, /CRIAR MINI ESCALA/);
  assert.match(dashboard, /Remanejar da escala/);
  assert.match(dashboard, /Extensão e hora extra/);
  assert.match(print, /ANEXO · OPERAÇÕES/);
});

test("monthly leave compilation is reviewed before one bulk confirmation", () => {
  const migration = readFileSync(resolve("drizzle/0012_leave_import.sql"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(migration, /idx_leave_choices_campaign_guard_date/);
  assert.match(api, /body\.action === "leave_import"/);
  assert.match(api, /await syncConfirmedLeaves\(\)/);
  assert.match(dashboard, /Conferir \{recognized\} folgas/);
  assert.match(dashboard, /Incluir \$\{validRows\.length\} folgas confirmadas/);
  assert.match(dashboard, /GM não encontrado/);
  assert.match(dashboard, /function splitLeaveImportRecords/);
  assert.match(dashboard, /matchAll\(\/\\b\(DIA\|NOITE\)/);
  assert.match(dashboard, /row\.shift==="NOITE"/);
  assert.match(dashboard, /leave-import-list/);
  assert.match(readFileSync(resolve("app/management.css"), "utf8"), /\.leave-import>fieldset\{display:block/);
});

test("monthly leave panorama highlights shift, roles, vehicle risks and links to the day", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /function buildLeaveOverview/);
  assert.match(api, /vehicleRisks/);
  assert.match(api, /pattern_role/);
  assert.match(api, /criticalThreshold/);
  assert.match(api, /vehicleTotal/);
  assert.match(dashboard, /Folgas por período de serviço/);
  assert.match(dashboard, /Motoristas/);
  assert.match(dashboard, /Abrir escala/);
  assert.match(dashboard, /\?date=\$\{day\.date\}/);
  assert.match(dashboard, /totalDay/);
  assert.match(dashboard, /totalNight/);
  assert.doesNotMatch(dashboard, /Abrir escala do dia mais carregado/);
});

test("monthly leave import can register an unknown GM during the review", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/management.css"), "utf8");
  assert.match(api, /newGuards/);
  assert.match(api, /normalizeImportName/);
  assert.match(api, /createdGuards/);
  assert.match(dashboard, /Matrícula \(opcional\)/);
  assert.match(dashboard, /Confirmação obrigatória antes de incluir/);
  assert.match(api, /registration \|\| `SEM-MATRICULA-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(api, /Todo GM novo precisa de um nome antes da importação/);
  assert.doesNotMatch(api, /Todo GM novo precisa de nome e matrícula antes da importação/);
  assert.match(api, /for \(let offset = 0; offset < uniqueRows\.length; offset \+= 75\)/);
  assert.match(dashboard, /confirmedNewGuards/);
  assert.match(dashboard, /leave-import-review-v2/);
  assert.match(dashboard, /Sem matrícula/);
  assert.match(styles, /\.leave-import-progress/);
  assert.match(styles, /\.leave-new-guard-confirm/);
});

test("leave import canonicalizes compound names and hides generated no-registration identifiers", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const scheduleApi = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /preferredLeaveNameMatch/);
  assert.match(api, /CASE WHEN registration LIKE 'SEM-MATRICULA-%' THEN NULL ELSE registration END/);
  assert.match(scheduleApi, /CASE WHEN g\.registration LIKE 'SEM-MATRICULA-%' THEN NULL ELSE g\.registration END AS registration/);
  assert.match(dashboard, /normalizeLeaveDisplayName/);
  assert.match(dashboard, /displayRegistration/);
});

test("leave import preserves compound names and prefers the readable registered spelling", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  assert.equal(normalizeLeaveDisplayName("  De   Souza "), "DE SOUZA");
  assert.equal(normalizeLeaveName("De Souza"), "DESOUZA");
  assert.equal(preferredLeaveNameMatch("desouza", [{ id: 2, name: "DESOUZA" }, { id: 1, name: "DE SOUZA" }])?.name, "DE SOUZA");
  assert.equal(preferredLeaveNameMatch("Lucas Martins", [{ id: 3, name: "LUCAS MARTINS" }])?.name, "LUCAS MARTINS");
  assert.match(dashboard, /leave-import-name-corrections/);
  assert.match(dashboard, /Nome completo do GM/);
  assert.match(api, /resolveExistingGuardName/);
  assert.match(api, /existingByName/);
});

test("pattern editor can create contextual posts and vehicles without duplicate fleet rows", () => {
  const api = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/pattern-resource-actions.css"), "utf8");
  assert.match(api, /body\.action === "add_post"/);
  assert.match(api, /body\.action === "add_vehicle"/);
  assert.match(api, /SELECT id,active FROM vehicles/);
  assert.match(api, /UPDATE vehicles SET type=\?,zone=\?,active=1/);
  assert.match(dashboard, /PatternResourceForm/);
  assert.match(dashboard, /onAddResource/);
  assert.match(dashboard, /Adicionar posto/);
  assert.match(dashboard, /Viatura \/ zona/);
  assert.match(dashboard, /Adicionar GM neste local/);
  assert.match(styles, /@media\(max-width:700px\)/);
});

test("schedule edits reject stale versions and refresh the visible scale", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(api, /function isStaleVersion/);
  assert.match(api, /expectedUpdatedAt/);
  assert.match(api, /expectedUpdatedAts/);
  assert.match(api, /alterada por outra pessoa/);
  assert.match(api, /an edit of an existing cell/);
  assert.match(api, /duplicateRows/);
  assert.match(schedule, /expectedUpdatedAt: pick\.assignment\?\.updated_at/);
  assert.match(schedule, /expectedUpdatedAts/);
  assert.match(schedule, /r\.status === 409 && j\.conflict/);
  assert.match(schedule, /await load\(\)/);
  assert.match(schedule, /const currentDateRef=useRef\(date\)/);
  assert.match(schedule, /const mutationDate=data\?\.date\|\|date/);
  assert.match(schedule, /currentDateRef\.current!==mutationDate/);
});

test("operation redeployment preserves and restores every source assignment", () => {
  const migration = readFileSync(resolve("drizzle/0013_operation_redeployments.sql"), "utf8");
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `operation_slot_origins`/);
  assert.match(api, /sourceType="redeployment"/);
  assert.match(api, /AVISAR REMANEJAMENTO/);
  assert.match(api, /async function restoreSlot/);
  assert.match(api, /async function restoreOperation/);
  assert.match(dashboard, /Remanejar da escala/);
  assert.match(dashboard, /Horários parcialmente sobrepostos não são remanejados automaticamente/);
  assert.match(dashboard, /useScheduleDate\(initialDate\)/);
  assert.match(dashboard, /detail="Preparando a escala operacional…"/);
});

test("confirmed operations must be explicitly reopened before editing slots", () => {
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  assert.match(api, /body\.action==="reopen"/);
  assert.match(api, /o\.status='draft'/);
  assert.match(api, /Reabra a operação antes de alterar suas vagas/);
  assert.match(dashboard, /Reabrir edição/);
  assert.match(dashboard, /bloqueada para evitar alterações acidentais/);
});

test("general service adjustments expose BH-, BH+ and service swaps in schedule and PDF", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const admin = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  const nav = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const migration = readFileSync(resolve("drizzle/0014_service_adjustments.sql"), "utf8");
  const history = readFileSync(resolve("app/api/history/route.ts"), "utf8");
  assert.match(api, /create_service_adjustment/);
  assert.match(api, /reorder_resource_assignments/);
  assert.match(api, /cancel_service_adjustment/);
  assert.match(api, /time_bank_positive/);
  assert.match(api, /negative_late/);
  assert.match(api, /counterpartServiceDate/);
  assert.match(api, /counterpart_service_date/);
  assert.match(api, /negativeHours/);
  assert.match(api, /settlementEnabled/);
  assert.match(api, /settlementDate! <= serviceDate/);
  assert.match(api, /createdSettlementAssignmentId/);
  assert.match(api, /settlement_date/);
  assert.match(api, /subtype === "swap"/);
  assert.match(api, /serviceAdjustments/);
  assert.match(admin, /service_adjustments/);
  assert.match(admin, /Trocas entre dias devem ser registradas/);
  assert.match(dashboard, /Banco de horas e trocas/);
  assert.match(dashboard, /BH\+ · pagar banco em dia extra/);
  assert.match(dashboard, /Pagar este BH- com BH\+ em outro dia/);
  assert.match(dashboard, /Quantidade do BH- \(horas\)/);
  assert.match(schedule, /service-adjustment-bottom/);
  assert.match(schedule, /liveServiceAdjustmentCode/);
  assert.match(schedule, /settlement_date/);
  assert.match(print, /print-service-adjustments/);
  assert.match(print, /printServiceAdjustmentCode/);
  assert.match(print, /settlement/);
  assert.match(nav, /\/bancos/);
  assert.match(migration, /idx_service_adjustments_date/);
  assert.match(migration, /idx_service_adjustments_settlement_date/);
  const laneMigration = readFileSync(resolve("drizzle/0015_assignment_lane_order.sql"), "utf8");
  assert.match(laneMigration, /lane_order/);
  assert.match(history, /assignment_lane/);
  });

test("manual overtime dashboard exposes actionable alerts, safe refresh state and an hours-band filter", () => {
  const api = readFileSync(resolve("app/api/overtime/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/overtime-enhancements.css"), "utf8");
  assert.match(api, /pattern_codes/);
  assert.match(dashboard, /function guardPatternCodes/);
  assert.match(dashboard, /he-pattern-summary/);
  assert.match(dashboard, /const pendingCount = data\.suggestions\.length/);
  assert.match(dashboard, /className="he-alerts"/);
  assert.doesNotMatch(dashboard, /missingRequestCount/);
  assert.match(dashboard, /suggestionsExpanded/);
  assert.match(dashboard, /he-suggestions-toggle/);
  assert.match(dashboard, /hoursBand/);
  assert.match(dashboard, /value="over12"/);
  assert.match(dashboard, /isRefreshing/);
  assert.match(dashboard, /Tentar novamente/);
  assert.match(dashboard, /function printReport/);
  assert.match(dashboard, /PDF \/ imprimir/);
  assert.match(styles, /\.he-alert-grid/);
  assert.match(styles, /\.he-load-error/);
  assert.match(styles, /@media print/);
  assert.match(styles, /\.overtime-page \.he-spreadsheet table\{width:100%/);
});

test("monthly operations distinguish absences, vehicle coverage and rapid sequential records", () => {
  const dashboard = readFileSync(resolve("app/management-dashboard.tsx"), "utf8");
  const planning = readFileSync(resolve("app/monthly-planning.tsx"), "utf8");
  const management = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/operational-clarity.css"), "utf8");
  const planningApi = readFileSync(resolve("app/api/planning/route.ts"), "utf8");
  assert.match(dashboard, /function AbsenceMini/);
  assert.match(dashboard, /Férias/);
  assert.match(dashboard, /Atestado/);
  assert.match(planning, /Viaturas para conferir/);
  assert.match(planning, /function VehiclePeriod/);
  assert.match(planning, /2º \+ 3º turno/);
  assert.match(planning, /4º \+ 1º turno/);
  assert.match(management, /Salvar e adicionar outro/);
  assert.match(management, /keepAdding/);
  assert.match(management, /tipo e período foram mantidos/);
  assert.match(planningApi, /rawType === "other_leave" \? "other"/);
  assert.match(styles, /\.planning-vehicle-focus/);
  assert.match(styles, /\.dashboard-absence-mini/);
  assert.match(styles, /\.he-suggestions-toggle/);
});

test("movement records keep a stable single-column flow and group guards expose the regular quick actions", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const management = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/operational-clarity.css"), "utf8");
  assert.match(management, /movement-record-summary/);
  assert.match(management, /movement-record-groups/);
  assert.match(styles, /\.record-list\.movement-records > \.movement-record-groups/);
  assert.match(styles, /content-visibility: visible/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(schedule, /operational-group-quick-actions/);
  assert.match(schedule, />Ajustar</);
  assert.match(schedule, />Trocar</);
  assert.match(schedule, />BH</);
  assert.match(schedule, />Detalhes</);
  assert.doesNotMatch(schedule, /className="operational-group-remove-segment"/);
  assert.match(schedule, /onDelete\(actionAssignment, shift\.id\)/);
  assert.match(styles, /\.dashboard-absence-mini/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("long post and vehicle names wrap instead of being clipped", () => {
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(density, /overflow-wrap:anywhere/);
  assert.match(density, /text-overflow:clip/);
  assert.match(density, /\.schedule th:first-child\{width:270px\}/);
  assert.match(density, /\.app\.compact \.schedule th:first-child\{width:235px\}/);
  assert.match(density, /\.pattern-resource>header>div>b/);
  assert.match(density, /\.pattern-resource>header>div>small/);
});

test("spreadsheet visual theme preserves the live grid controls while restyling the matrix", () => {
  const layout = readFileSync(resolve("app/layout.tsx"), "utf8");
  const theme = readFileSync(resolve("app/spreadsheet-theme.css"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(layout, /spreadsheet-theme\.css/);
  assert.match(theme, /\.schedule tbody tr\.group td/);
  assert.match(theme, /\.schedule th\.period-day-head/);
  assert.match(theme, /\.schedule th\.period-night-head/);
  assert.match(theme, /\.app\.compact \.schedule th:first-child/);
  assert.match(theme, /\.live-person-card \.live-person/);
  assert.match(theme, /@media screen/);
  assert.match(theme, /\.schedule tbody tr\.post-row > td:first-child[\s\S]*?z-index: 20/);
  assert.match(theme, /\.schedule tbody tr\.vehicle-row > td:not\(:first-child\)[\s\S]*?isolation: isolate/);
  assert.match(theme, /\.schedule thead tr:first-child > th:first-child[\s\S]*?z-index: 40/);
  assert.match(theme, /\.schedule tbody tr\.post-row > td\.drop-cell \.cell-quick-actions[\s\S]*?max-width: 100%/);
  assert.match(theme, /@media \(max-width: 600px\)[\s\S]*?\.schedule tbody tr\.vehicle-row \.resource/);
  assert.match(schedule, /className="schedule-add-trigger"/);
  assert.match(schedule, /className="resource-add-person"/);
  assert.match(schedule, /className="inline-he-extension"/);
});

test("manual HE suggestions can be persistently dismissed", () => {
  const api = readFileSync(resolve("app/api/overtime/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(api, /body\.action === "suggestion_dismiss"/);
  assert.match(api, /status='not_performed'/);
  assert.match(api, /not_performed','cancelled/);
  assert.match(dashboard, /async function dismissSuggestion/);
  assert.match(dashboard, /action: "suggestion_dismiss"/);
  assert.match(dashboard, /className="dismiss"/);
  assert.match(dashboard, />Dispensar<\/button>/);
  assert.match(styles, /\.he-suggestion-actions/);
});

test("management modules reuse a date-scoped cache while synchronizing D1 silently", () => {
  const source = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(source, /escala-admin-cache/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /writeAdminCache\(date, mode, next\)/);
  assert.match(source, /Nao foi possivel sincronizar os dados operacionais/);
});

test("pattern editor reuses the current date cache and refreshes it after synchronization", () => {
  const source = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  assert.match(source, /escala-patterns-cache/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /useState<Data \| null>\(null\)/);
  assert.match(source, /const cached = readPatternCache\(date\)/);
  assert.match(source, /void load\(Boolean\(cached\)\)/);
  assert.match(source, /writePatternCache\(date, normalized\)/);
});

test("operational notices can be edited in place with an auditable API action", () => {
  const api = readFileSync(resolve("app/api/notices/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/notices-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/notices.css"), "utf8");
  assert.match(api, /action==="create"\|\|action==="update"/);
  assert.match(api, /UPDATE operational_notices SET effective_date/);
  assert.match(api, /Editou o lembrete/);
  assert.match(dashboard, /action: "update"/);
  assert.match(dashboard, /NoticeEditor/);
  assert.match(dashboard, />Editar<\/button>/);
  assert.match(styles, /\.notice-editor-backdrop/);
});

test("fleet panorama prevents duplicate status actions while a change is saving", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(dashboard, /function activeVehicleOutages\(outages:Item\[\],date:string\)/);
  assert.match(dashboard, /const activeOutages=useMemo\(\(\)=>activeVehicleOutages\(outages,date\)/);
  assert.match(dashboard, /className="fleet-status" aria-busy=\{saving\}/);
  assert.match(dashboard, /<select name="vehicleId" required defaultValue="" disabled=\{saving\}/);
  assert.match(dashboard, /<FleetPanorama[\s\S]*saving=\{saving\}/);
  assert.match(dashboard, /function FleetPanorama\(\{date,vehicles,outages,crews,saving/);
  assert.match(dashboard, /<button disabled=\{saving\} onClick=\{\(\)=>onEdit\(vehicle\)\}>Editar<\/button>/);
  assert.match(dashboard, /className="available" disabled=\{saving\} onClick=\{\(\)=>onClearOutage\(outage\.id\)\}/);
  assert.match(dashboard, /className="outage" disabled=\{saving\} onClick=\{\(\)=>onQuickOutage\(vehicle\)\}/);
  assert.match(styles, /fleet-card-actions button:disabled/);
});

test("catalog edits and ordering share the saving guard", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(dashboard, /if \(!editing \|\| saving\) return;/);
  assert.match(dashboard, /action: "catalog_update"/);
  assert.match(dashboard, /action: "catalog_deactivate"/);
  assert.match(dashboard, /action: "post_reorder"/);
  assert.match(dashboard, /function CatalogEditor\(\{[\s\S]*saving/);
  assert.match(dashboard, /disabled=\{saving\}>\{saving \? "Salvando…" : "Salvar mudanças"\}/);
  assert.match(dashboard, /function Record\(\{[\s\S]*saving/);
});

test("new catalog records update the local management view without a full reload", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(dashboard, /const catalogKey = action === "guard" \? "guards"/);
  assert.match(dashboard, /if \(catalogKey && j\.entity\)/);
  assert.match(dashboard, /writeAdminCache\(date, mode, next\)/);
  assert.match(dashboard, /const sectionKey = `POST:\$\{String\(body\.groupName/);
  assert.match(dashboard, /return;\n\s*}\n\s*if \(action === "movement"/);
});

test("daily scale exposes contextual post editing without a full reload", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/workforce.css"), "utf8");
  assert.match(schedule, /\[postEdit, setPostEdit\] = useState<Rec \| null>\(null\)/);
  assert.match(schedule, /async function savePostQuick/);
  assert.match(schedule, /action: "catalog_update"/);
  assert.match(schedule, /entity: "post"/);
  assert.match(schedule, /onEditPost=\{setPostEdit\}/);
  assert.match(schedule, /function PostQuickEditor/);
  assert.match(schedule, /className="resource-quick-button"/);
  assert.match(api, /const sortOrder = Number\.isFinite\(Number\(body\.sortOrder\)\)/);
  assert.match(styles, /\.resource-quick-button/);
});

test("daily scale exposes contextual section editing", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(schedule, /\[sectionEdit, setSectionEdit\] = useState/);
  assert.match(schedule, /async function saveSectionQuick/);
  assert.match(schedule, /action: "section_update"/);
  assert.match(schedule, /onEditSection=\{\(sectionKey, label\) => setSectionEdit/);
  assert.match(schedule, /function SectionQuickEditor/);
  assert.match(schedule, /className="section-inline-edit"/);
  assert.match(styles, /\.section-inline-edit/);
});

test("selected GM cards expose a quick adjustment dialog before the advanced editor", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/contextual-actions.css"), "utf8");
  assert.match(schedule, /\[quickEdit, setQuickEdit\] = useState/);
  assert.match(schedule, /async function saveQuickAssignment/);
  assert.match(schedule, /function QuickAssignmentEditor/);
  assert.match(schedule, /className="primary-action" onClick=\{\(\)=>onQuickEdit/);
  assert.match(schedule, /onQuickEdit=\{setQuickEdit\}/);
  assert.match(schedule, /expectedUpdatedAt: assignment\.updated_at/);
  assert.match(styles, /\.cell-quick-actions \.primary-action/);
});

test("dragging a GM highlights compatible and blocked schedule destinations", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/drag-edit.css"), "utf8");
  assert.match(schedule, /\[draggingAssignmentId,setDraggingAssignmentId\]=useState/);
  assert.match(schedule, /function canReceiveDrag/);
  assert.match(schedule, /className=\{`\$\{missingRoles\.length/);
  assert.match(schedule, /drag-drop-ready/);
  assert.match(schedule, /onDragStart\(a\)/);
  assert.match(schedule, /onDragEnd=\{onDragEnd\}/);
  assert.match(schedule, /if \(canReceiveDrag\(s\.id\)\) drop\(e, s\.id\)/);
  assert.match(styles, /\.drop-cell\.drag-drop-ready/);
  assert.match(styles, /\.drop-cell\.drag-drop-blocked/);
});

test("schedule collaboration exposes refresh time and conflict recovery", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /\[conflictNotice, setConflictNotice\] = useState/);
  assert.match(schedule, /\[lastSyncedAt, setLastSyncedAt\] = useState/);
  assert.match(schedule, /setInterval\(\(\) =>/);
  assert.match(schedule, /60_000/);
  assert.match(schedule, /className="schedule-conflict-notice"/);
  assert.match(schedule, /className="sync-refresh"/);
  assert.match(styles, /\.schedule-conflict-notice/);
  assert.match(styles, /\.sync-refresh/);
});

test("schedule refresh keeps the visible grid while synchronizing in the background", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/live-schedule.css"), "utf8");
  assert.match(schedule, /\[syncing, setSyncing\] = useState\(false\)/);
  assert.match(schedule, /const load = useCallback\(async \(background = true\)/);
  assert.match(schedule, /readScheduleCache\(date\);if\(cached&&!background\)setData\(cached\)/);
  assert.match(schedule, /void load\(true\)/);
  assert.match(schedule, /schedule-sync-banner/);
  assert.match(styles, /\.schedule-sync-banner/);
});

test("schedule cells support keyboard navigation and contextual activation", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/drag-edit.css"), "utf8");
  assert.match(schedule, /KeyboardEvent as ReactKeyboardEvent/);
  assert.match(schedule, /function navigateCell/);
  assert.match(schedule, /event\.key === "ArrowLeft"/);
  assert.match(schedule, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(schedule, /tabIndex=\{0\}/);
  assert.match(schedule, /className="keyboard-help"/);
  assert.match(styles, /\.drop-cell:focus-visible/);
});

test("spreadsheet grid keeps the resource header above the turn headers and aligns row separators", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/spreadsheet-theme.css"), "utf8");
  assert.match(schedule, /<td className="resource-cell">\s*<div className="resource">/);
  assert.match(styles, /\.schedule thead tr:first-child > th:first-child/);
  assert.match(styles, /\.schedule thead tr:nth-child\(2\) > th\s*\{\s*top: 34px/);
  assert.match(styles, /\.schedule thead tr:nth-child\(2\) > th:first-child/);
  assert.match(styles, /border-collapse: separate/);
  assert.match(styles, /border-bottom: 4px solid #dbe5ee/);
  assert.match(styles, /vertical-align: top/);
});

test("schedule keeps a small queue of recent undoable changes", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /\[undoEvents, setUndoEvents\] = useState<UndoState\[\]>\(\[\]\)/);
  assert.match(schedule, /function registerUndo\(event: UndoState\)/);
  assert.match(schedule, /setUndoEvents\(\(current\) => \[event, \.\.\.current\.filter\(\(item\) => item\.id !== event\.id\)\]\.slice\(0, 5\)\)/);
  assert.match(schedule, /undoEvents\.length>0/);
  assert.match(schedule, /undoEvents\.length>1/);
  assert.match(schedule, /schedule-toast-undo-label/);
  assert.match(schedule, /undoEvents\[0\]\.label/);
});

test("overtime dashboard reuses a month cache while refreshing the live book", () => {
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  assert.match(dashboard, /const overtimeCacheKey = \(month: string\)/);
  assert.match(dashboard, /function readOvertimeCache\(month: string\): Data \| null/);
  assert.match(dashboard, /function writeOvertimeCache\(data: Data\)/);
  assert.match(dashboard, /useState<Data \| null>\(null\)/);
  assert.match(dashboard, /const cached = readOvertimeCache\(month\)/);
  assert.match(dashboard, /writeOvertimeCache\(next\)/);
  assert.match(dashboard, /const isRefreshing = loading \|\| syncing \|\| !monthMatches/);
});

test("overtime edits refresh silently without replacing the visible book", () => {
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  assert.match(dashboard, /const \[syncing, setSyncing\] = useState\(false\)/);
  assert.match(dashboard, /const load = useCallback\(async \(background = false\)/);
  assert.match(dashboard, /if \(cached && !background\) setData\(cached\)/);
  assert.match(dashboard, /if \(response\.ok\) await load\(true\)/);
  assert.match(dashboard, /const isRefreshing = loading \|\| syncing \|\| !monthMatches/);
});

test("publication validation respects FA resources and reports actionable critical issues", () => {
  const api = readFileSync(resolve("app/api/publish/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/validate-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/validation.css"), "utf8");
  assert.match(api, /schedule_resource_exclusions/);
  assert.match(api, /vehicle_outages/);
  assert.match(api, /vehicle_return_reconciliations/);
  assert.match(api, /missingRoles/);
  assert.match(api, /overlapping/);
  assert.match(api, /severity: "critical"/);
  assert.match(api, /export async function GET\(request: Request\)/);
  assert.match(api, /loadValidationData\(scheduleId, textValue\(schedule\.date\)\)/);
  assert.match(dashboard, /normalizeIssues/);
  assert.match(dashboard, /api\/publish\?scheduleId=/);
  assert.match(dashboard, /pendências críticas/);
  assert.match(dashboard, /Abrir escala/);
  assert.match(dashboard, /validation-issue/);
  assert.match(dashboard, /issuesForPeriod\.slice\(0, visibleIssues\)/);
  assert.match(dashboard, /Mostrar mais pendências/);
  assert.match(dashboard, /hrefFor\("\/escala"\)/);
  assert.match(styles, /validation-severity-summary/);
  assert.match(styles, /validation-issue\.warning/);
});

test("large overtime books start compact and can progressively reveal more GMs", () => {
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  assert.match(dashboard, /useState\(60\)/);
  assert.match(dashboard, /ranking\.slice\(0,visibleLimit\)/);
  assert.match(dashboard, /Mostrar mais GMs/);
});

test("cancelling a confirmed leave promotes the next waitlisted GM and syncs the scale", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /promoteNextWaitlistedLeave/);
  assert.match(api, /normalizeWaitlistPositions/);
  assert.match(api, /status='waitlist'/);
  assert.match(api, /promotedGuardName/);
  assert.match(api, /syncConfirmedLeaves\(Number\(next\.id\)\)/);
  assert.match(dashboard, /foi promovido\(a\) automaticamente da lista de espera/);
  assert.match(dashboard, /posição \$\{item\.position\}/);
});

test("monthly leave capacity supports platoon overrides with a general fallback", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/management.css"), "utf8");
  const migration = readFileSync(resolve("drizzle/0016_leave_limit_shift.sql"), "utf8");
  assert.match(api, /resolveLeaveCapacity/);
  assert.match(api, /leave_limit_set/);
  assert.match(api, /TRIM\(COALESCE\(platoon,''\)\)/);
  assert.match(api, /guardLeavePeriod/);
  assert.match(api, /shift IS NULL/);
  assert.match(api, /platoon_shift/);
  assert.match(api, /ensureLeaveDayLimitShift/);
  assert.match(api, /waitlistPosition/);
  assert.match(dashboard, /Limite por dia, equipe e turno/);
  assert.match(dashboard, /Limite geral do dia/);
  assert.match(dashboard, /name="shift"/);
  assert.match(dashboard, /leave_limit_set/);
  assert.match(styles, /leave-limit-panel/);
  assert.match(migration, /ADD COLUMN `shift`/);
  assert.match(migration, /campaign_date_platoon_shift/);
});

test("monthly leave campaigns have a guarded close, publish and reopen lifecycle", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/management.css"), "utf8");
  assert.match(api, /leave_campaign_close/);
  assert.match(api, /leave_campaign_publish/);
  assert.match(api, /leave_campaign_reopen/);
  assert.match(api, /Resolva as .*lista de espera/);
  assert.match(api, /status='published'/);
  assert.match(api, /justificativa/);
  assert.doesNotMatch(dashboard, /campaignAction/);
  assert.match(dashboard, /const campaignLocked = false/);
  assert.doesNotMatch(dashboard, /<section className=\{`leave-campaign-status/);
  assert.match(dashboard, /Edição livre: importe, ajuste ou remova folgas/);
  assert.match(styles, /leave-campaign-status/);
});

test("monthly leave editing does not depend on the historical campaign status", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /SELECT \* FROM leave_campaigns WHERE month=\? LIMIT 1/);
  assert.match(api, /INSERT OR IGNORE INTO leave_campaigns/);
  assert.match(api, /A data não pertence ao mês de folgas selecionado/);
  assert.doesNotMatch(api, /leaveCampaign\.status !== "open"/);
  assert.doesNotMatch(api, /approvalCampaign\.status !== "open"/);
  assert.doesNotMatch(api, /cancellationCampaign\.status !== "open"/);
  assert.match(dashboard, /const campaignLocked = false/);
  assert.match(dashboard, /locked=\{campaignLocked\}/);
});

test("operational groups are managed in patterns and scoped to D1/D2/N1/N2", () => {
  const api = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const groupsDb = readFileSync(resolve("lib/operational-groups-db.ts"), "utf8");
  assert.match(api, /pattern_operational_group_members/);
  assert.match(api, /operational_group_create/);
  assert.match(api, /pattern_operational_group_member_set/);
  assert.match(api, /operational_group_member_set/);
  assert.match(dashboard, /PatternGroupsPanel/);
  assert.match(dashboard, /D1/);
  assert.match(dashboard, /D2/);
  assert.match(dashboard, /N1/);
  assert.match(dashboard, /N2/);
  assert.match(dashboard, /Todos os padrões/);
  assert.match(groupsDb, /pattern_operational_group_members/);
});

test("conventional patterns stay prominent while groups remain at the end of the page", () => {
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/patterns-enhanced.css"), "utf8");
  const conventional = dashboard.indexOf('className="pattern-conventional-focus"');
  const groups = dashboard.indexOf("<PatternGroupsPanel data={data}");
  assert.ok(conventional >= 0);
  assert.ok(groups > conventional);
  assert.match(dashboard, /Padrões convencionais 12x36/);
  assert.match(dashboard, /D1 · D2 · N1 · N2/);
  assert.match(styles, /\.pattern-conventional-focus/);
  assert.match(styles, /\.pattern-conventional-heading/);
});

test("pattern group links are exposed to the applied daily scale", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(api, /pattern_operational_group_members/);
  assert.match(api, /pattern_period/);
  assert.match(api, /const contextualMembers = \[\.\.\.operationalGroupMembers\.results, \.\.\.patternOperationalGroupMembers\.results\]/);
  assert.match(api, /operationalGroupMembers: contextualMembers/);
  assert.match(dashboard, /operationalGroupByResource/);
  assert.match(dashboard, /operationalGroupByGuard/);
  assert.match(dashboard, /operationalGroupByGuardShift/);
  assert.match(dashboard, /guardOperationalMetaByShift/);
});

test("weekly pattern cards distinguish regular hours from fixed daily overtime", () => {
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/patterns-enhanced.css"), "utf8");
  assert.match(dashboard, /Escala semanal/);
  assert.match(dashboard, /HE fixa por dia/);
  assert.match(dashboard, /SEG · TER · QUA · QUI · SEX/);
  assert.match(dashboard, /timeAfterHours\(regularEnd, overtimeHours\)/);
  assert.match(dashboard, /regular_end/);
  assert.match(dashboard, /overtime_end/);
  assert.match(api, /work_regime='weekly'/);
  assert.match(schedule, /fixedWeeklyOvertimeLabel/);
  assert.match(schedule, /weekly-fixed-he/);
  assert.match(styles, /\.weekly-slot-card/);
  assert.match(styles, /\.weekly-he-badge/);
});

test("operational modules reuse a short-lived session cache without replacing live data", () => {
  const cache = readFileSync(resolve("app/client-cache.ts"), "utf8");
  const operations = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  const notices = readFileSync(resolve("app/notices-dashboard.tsx"), "utf8");
  assert.match(cache, /readClientCache/);
  assert.match(cache, /writeClientCache/);
  assert.match(operations, /gmnh:operations/);
  assert.match(operations, /readClientCache<Data>/);
  assert.match(operations, /writeClientCache\(operationsCacheKey\(date\),data\)/);
  assert.match(notices, /gmnh:notices/);
  assert.match(notices, /writeClientCache\(noticesCacheKey, nextItems\)/);
  assert.match(notices, /const cachedItems = readNoticesCache\(\)/);
  assert.match(notices, /void load\(\)/);
});

test("applied operational groups render as sessions inside the main scale grid", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const scheduleStyles = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.doesNotMatch(schedule, /<OperationalGroupsSection/);
  assert.match(schedule, /className="operational-group-heading"/);
  assert.match(schedule, /operational-group-section-label/);
  assert.match(schedule, /sessão da escala|sessao da escala/);
  assert.match(scheduleStyles, /\.operational-group-section-label/);
  assert.match(scheduleStyles, /\.operational-group-mark/);
  assert.match(schedule, /activeGroupFilter/);
  assert.match(schedule, /setGroupFilter\("all"\)/);
  assert.match(schedule, /filter\(\(\[, count\]\) => count > 0\)/);
  assert.match(schedule, /pattern_period/);
  assert.match(schedule, /OperationalGroupsGrid/);
  assert.match(schedule, /GRUPAMENTOS E EQUIPES/);
  assert.match(schedule, /Sem VTR ou posto definido no padrão/);
  assert.match(schedule, /NÃO LANÇADO NESTA ESCALA/);
  assert.match(schedule, /firstPostIndex/);
  assert.match(scheduleStyles, /\.operational-groups-grid-team/);
});

test("monthly planning aggregates patterns, absences and resource coverage in one view", () => {
  const api = readFileSync(resolve("app/api/planning/route.ts"), "utf8");
  const page = readFileSync(resolve("app/monthly-planning.tsx"), "utf8");
  const printPage = readFileSync(resolve("app/monthly-planning-print.tsx"), "utf8");
  const printRoute = readFileSync(resolve("app/planejamento/impressao/page.tsx"), "utf8");
  const printStyles = readFileSync(resolve("app/monthly-planning-print.css"), "utf8");
  const priorityStyles = readFileSync(resolve("app/monthly-planning-priority.css"), "utf8");
  const nav = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const styles = readFileSync(resolve("app/monthly-planning.css"), "utf8");
  assert.match(api, /shift_patterns/);
  assert.match(api, /weekly_slots/);
  assert.match(api, /leave_choices/);
  assert.match(api, /service_adjustments/);
  assert.match(api, /vehicle_outages/);
  assert.match(api, /operational_group_members/);
  assert.match(api, /negative_full/);
  assert.match(api, /parseScenario/);
  assert.match(api, /scenarioGuardById/);
  assert.match(api, /scenarioVehicleById/);
  assert.match(api, /overtimeNeeded/);
  assert.match(page, /Planejamento mensal/);
  assert.match(page, /Simulação rápida/);
  assert.match(page, /Adicionar e recalcular/);
  assert.match(page, /PDF panorama/);
  assert.match(page, /Prioridades por período/);
  assert.match(page, /planning-priority-period/);
  assert.match(page, /Com impacto/);
  assert.match(page, /scrollIntoView/);
  assert.match(page, /planning-day-detail/);
  assert.match(page, /GMs disponíveis/);
  assert.match(page, /PlanningMonthPeriod/);
  assert.match(page, /Abrir escala completa/);
  assert.match(page, /Grupamentos/);
  assert.match(nav, /href: "\/planejamento"/);
  assert.match(styles, /\.planning-calendar/);
  assert.match(styles, /\.planning-simulation/);
  assert.match(styles, /\.planning-resource-list/);
  assert.match(printPage, /PLANEJAMENTO MENSAL/);
  assert.match(printPage, /Imprimir \/ salvar PDF/);
  assert.match(printPage, /Recursos para conferir/);
  assert.match(printRoute, /MonthlyPlanningPrint/);
  assert.match(printStyles, /@page/);
  assert.match(priorityStyles, /\.planning-priority/);
});
test("absence records use inclusive dates, grouped filters and conflict protection", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/management.css"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  assert.match(dashboard, /function MovementRecords\(/);
  assert.match(dashboard, /type="date"/);
  assert.match(dashboard, /other_leave/);
  assert.match(dashboard, /movement-record-groups/);
  assert.match(api, /async function validateMovement/);
  assert.match(api, /m\.status IN \('approved','pending'\)/);
  assert.match(api, /já está vinculado a outro afastamento/);
  assert.match(styles, /\.movement-filters/);
  assert.match(styles, /\.movement-record-group/);
  assert.match(print, /types: \["medical_leave", "other_leave"\]/);
  assert.match(print, /displayedEnd/);
});

test("pattern grupamento members can own a turn and VTR without duplicating the conventional scale", () => {
  const db = readFileSync(resolve("lib/operational-groups-db.ts"), "utf8");
  const engine = readFileSync(resolve("lib/pattern-engine.ts"), "utf8");
  const patternsApi = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const scheduleApi = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  assert.match(db, /ALTER TABLE pattern_operational_group_members ADD COLUMN \$\{name\} \$\{definition\}/);
  assert.match(db, /\["shift", "TEXT"\]/);
  assert.match(engine, /groupAssignments/);
  assert.match(engine, /groupAssignmentsByPattern/);
  assert.match(engine, /operationalGroupInterval/);
  assert.match(engine, /const vehicleId = groupAssignment\.vehicle_id/);
  assert.match(patternsApi, /m\.shift,m\.vehicle_id,m\.starts_at,m\.ends_at/);
  assert.match(patternsApi, /pattern_operational_group_members \(pattern_id,group_id,resource_kind,resource_id,team_label,shift,vehicle_id/);
  assert.match(patternsApi, /requestedVehicleId/);
  assert.match(scheduleApi, /m\.shift,m\.vehicle_id,m\.starts_at,m\.ends_at/);
  assert.match(schedule, /ownedMember\?\.pattern_id/);
  assert.match(schedule, /member\.vehicle_id/);
  assert.match(schedule, /operational-groups-grid-time/);
  assert.match(print, /isGroupOwnedAssignment/);
  assert.match(print, /PrintOperationalGroupRows/);
  assert.match(dashboard, /VTR do grupamento/);
  assert.match(dashboard, /Início da jornada de 12h/);
});

test("management dashboard is the home page and combines monthly staffing with daily notes", () => {
  const home = readFileSync(resolve("app/page.tsx"), "utf8");
  const dashboard = readFileSync(resolve("app/management-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/management-dashboard.css"), "utf8");
  const notices = readFileSync(resolve("app/api/notices/route.ts"), "utf8");
  const nav = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const schedulePage = readFileSync(resolve("app/escala/page.tsx"), "utf8");
  assert.match(home, /ManagementDashboard/);
  assert.match(schedulePage, /LiveSchedule/);
  assert.match(nav, /href: "\/escala"/);
  assert.match(dashboard, /Dashboard de gestão/);
  assert.match(dashboard, /Efetivo por dia/);
  assert.match(dashboard, /DashboardPeriodOverview/);
  assert.match(dashboard, /Furos projetados por período/);
  assert.match(dashboard, /periodPriorities\(days, "day"\)/);
  assert.match(dashboard, /periodPriorities\(days, "night"\)/);
  assert.match(dashboard, /weekDays\[day\.weekday\]/);
  assert.match(dashboard, /folgas com impacto/);
  assert.match(dashboard, /OBSERVAÇÕES DO DIA/);
  assert.match(dashboard, /api\/planning\?month=/);
  assert.match(dashboard, /api\/notices\?month=/);
  assert.match(dashboard, /Adicionar observação/);
  assert.match(notices, /effective_date>=\?/);
  assert.match(notices, /nextMonth/);
  assert.match(styles, /\.dashboard-calendar/);
  assert.match(styles, /\.dashboard-priority-columns/);
  assert.match(styles, /@media\(max-width:760px\)/);
});

test("holes are filled alerts and redeployment keeps the complete operational period above the grid", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  const poolPosition = schedule.indexOf("redeployment-pool redeployment-pool-top");
  const workspacePosition = schedule.indexOf("<div className={`workspace");
  assert.ok(poolPosition >= 0 && poolPosition < workspacePosition);
  assert.match(schedule, /availableGroup\.period === targetPeriod/);
  assert.match(schedule, /moveGroup\(availableGroup\.assignments, kind, resource\)/);
  assert.match(schedule, /O bloco reúne os dois turnos/);
  assert.match(styles, /\.schedule td\.furo\{background:#fff0f1!important/);
  assert.match(styles, /\.schedule \.live-hole\{min-height:38px;border:2px solid #d51f32!important/);
  assert.match(styles, /\.redeployment-pool\.redeployment-pool-top/);
});

test("leave imports stay 12x36 while the weekly editor can explicitly convert a selected GM", () => {
  const adminApi = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const patternsApi = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const patterns = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  assert.match(adminApi, /requested\.baseShift \|\| "12x36 dia", "12x36"/);
  assert.match(patternsApi, /work_regime='weekly',base_shift='Semanal'/);
  assert.match(patternsApi, /SELECT id FROM guards WHERE id=\? AND active=1/);
  assert.match(patternsApi, /guardUsesRegime\(guardId, "12x36"\)/);
  assert.match(patterns, /eligibleGuards = data\.guards/);
  assert.match(patterns, /o GM passa para o regime semanal e deixa de ocupar os padrões 12x36/);
  assert.match(patterns, /unassignedGuards = shiftGuards\(data\.guards\)/);
});

test("fleet views group vehicle types and expose date-specific available and FA prefixes", () => {
  const management = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const dashboard = readFileSync(resolve("app/management-dashboard.tsx"), "utf8");
  const planningApi = readFileSync(resolve("app/api/planning/route.ts"), "utf8");
  const managementStyles = readFileSync(resolve("app/management.css"), "utf8");
  const dashboardStyles = readFileSync(resolve("app/management-dashboard.css"), "utf8");
  assert.match(management, /fleet-type-groups/);
  assert.match(management, /vehicleIconLabel\(group\.type\)/);
  assert.match(management, /availableCount/);
  assert.match(planningApi, /fleetByType/);
  assert.match(planningApi, /outageFor\(vehicle\.id, date\)/);
  assert.match(planningApi, /availablePrefixes/);
  assert.match(planningApi, /outagePrefixes/);
  assert.match(dashboard, /function DashboardFleet/);
  assert.match(dashboard, /Disponíveis:/);
  assert.match(dashboard, /Em FA:/);
  assert.match(managementStyles, /\.fleet-type-group/);
  assert.match(dashboardStyles, /\.dashboard-fleet-types/);
});

test("operations allow safe basic edits and expose their impact before confirmation", () => {
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/operations-refinements.css"), "utf8");
  assert.match(api, /body\.action==="update_details"/);
  assert.match(api, /Reabra a operação antes de editar seus dados/);
  assert.match(api, /UPDATE operations SET title=\?,location=\?,commander=\?,reference=\?,notes=\?/);
  assert.match(dashboard, /function EditOperationDialog/);
  assert.match(dashboard, /function OperationImpact/);
  assert.match(dashboard, /Antes de confirmar/);
  assert.match(dashboard, /Editar dados/);
  assert.match(styles, /\.operation-impact/);
  assert.match(styles, /\.operation-edit-protection/);
});

test("movement records support fast active, future and completed filters without loading every record", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/management.css"), "utf8");
  assert.match(api, /movementScope/);
  assert.match(api, /m\.starts_at<\? AND m\.ends_at>\?/);
  assert.match(api, /m\.starts_at>=\?/);
  assert.match(api, /m\.ends_at<=\?/);
  assert.match(dashboard, /Ativos nesta data/);
  assert.match(dashboard, /Começam depois/);
  assert.match(dashboard, /Já encerrados/);
  assert.match(dashboard, /movementDateFrom/);
  assert.match(styles, /\.movement-quick-scopes/);
});

test("validation separates day and night issues before publication", () => {
  const validation = readFileSync(resolve("app/validate-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/validation.css"), "utf8");
  assert.match(validation, /issuePeriod\(issue\)/);
  assert.match(validation, /Pendências do diurno/);
  assert.match(validation, /Pendências do noturno/);
  assert.match(validation, /☀ Diurno/);
  assert.match(validation, /☾ Noturno/);
  assert.match(styles, /\.validation-period-tabs/);
});

test("operational group GM cards keep contextual actions and offer same-group HE suggestions", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(schedule, /onSuggestHe: \(assignment: Rec, shift: string, member: Rec\)/);
  assert.match(schedule, /HE do grupamento/);
  assert.match(schedule, /pick\.groupId/);
  assert.match(schedule, /integrante do mesmo grupamento em dia\/equipe oposta/);
  assert.match(schedule, /onAdjust\(actionAssignment, shift\.id\)/);
  assert.match(schedule, /onQuickStatus\(actionAssignment/);
  assert.match(schedule, /onDelete\(actionAssignment, shift\.id\)/);
  assert.match(schedule, /const memberAssignments = assignments\.filter/);
  assert.match(schedule, /\|\| memberAssignments\[0\]/);
  assert.match(schedule, /draggable=\{Boolean\(actionAssignment\)\}/);
  assert.match(schedule, /dataTransfer\.setData\("text\/assignment"/);
  assert.match(schedule, /assignment \? assignmentDisplayInShift\(assignment, date, shift\.id\) : configuredTime/);
  assert.match(schedule, /const teamVehicleIds = \[\.\.\.new Set/);
  assert.match(schedule, /NÃO LANÇADO NESTA ESCALA/);
  assert.doesNotMatch(schedule, /\+ VTR \/ dupla/);
  assert.doesNotMatch(schedule, /"Selecionar destino"/);
  assert.match(styles, /\.group-he-suggestions/);
});

test("pattern editor separates day and night comparison and protects replacement", () => {
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/patterns-enhanced.css"), "utf8");
  assert.match(dashboard, /pattern-period-switcher/);
  assert.match(dashboard, /D1 × D2/);
  assert.match(dashboard, /N1 × N2/);
  assert.match(dashboard, /pattern-group-board/);
  assert.match(dashboard, /pattern-preview-confirmation/);
  assert.match(dashboard, /\/api\/history/);
  assert.match(api, /currentSchedule/);
  assert.match(api, /acknowledgeManual/);
  assert.match(api, /requiresReview/);
  assert.match(styles, /\.pattern-period-switcher/);
  assert.match(styles, /\.pattern-group-board/);
  assert.match(styles, /\.pattern-preview-warning/);
});
