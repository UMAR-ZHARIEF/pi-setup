// planbuild classifier: plan-mode verdicts for MCP sub-commands AND for non-MPC tools.
// Pure module: no Pi imports.
//
// Why: in plan mode, MCP tool-server calls arrive as namespace proxies named
// "mcp__<server>" with an input envelope {tool, args} (pi-mcp-adapter
// namespace-tools.ts). The rule engine only ever sees the proxy name, so every
// serena/github/... call looked identical to the gate. This module classifies the
// sub-command into allow (silent) or deny (hard block with a switch-to-build
// message, never a popup).
//
// ZERO POPUPS (user decision 2026-11-05): the ask tier is EMPTY by design.
// classifyMcpCall never returns "ask"; anything not classified as a known read
// is refused with the switch-to-build reason (see UNCLASSIFIED_REASON), so plan
// mode can never open a permission popup. The "ask" variant is kept in McpClass
// only for typing compatibility with the engine (plan .pi/plans/planbuild-zero-popups.md).
//
// Matching rule: EXACT names only. Every list below is enumerated from the live
// adapter inventory (C:\Users\Guess\.pi\agent\mcp-cache.json, runtime truth,
// machine rule 37), so an unknown future tool can never silently classify as a
// read. The plan states the github read tier as prefixes (get_/list_/search_);
// that one rule is materialized as the explicit list of inventory names matching
// those prefixes. The playwright servers are allowed as whole servers (user
// decision 2026-11-05: all browser tools, viewing AND interactions, allowed in
// plan mode; research browsing must never be interrupted).
//
// Subtool normalization: the adapter resolves several candidate spellings of the
// same server tool (types.ts getToolNameCandidates), so input.tool may be the bare
// inventory name ("edit_memory") or a prefixed form ("serena_edit_memory",
// "mcp__serena_edit_memory"). normalizeSubtool strips an optional leading "mcp__"
// and an optional leading "<server>_" once, then lists match exactly.
//
// Config onboarding doors (plan .pi/plans/planbuild-web-tools-strict.md part 6):
// planbuild.json gains planAllowServers (whole servers admitted as reads) and
// planAllowTools (individual tool names). classifyMcpCall consults them BEFORE the
// built-in tiers, but a config entry can only ADD allows, never unblock a classified
// mutation: a name on the server's built-in deny tier stays denied, and the mcp
// gateway (it reaches any server) is never admittable. The unclassified-denial
// reason names the config path so a future read can be admitted without a code
// change. customRules (the old generic rule door) is removed; these two keys are
// the only onboarding doors.

export type McpClass = "allow" | "deny" | "ask";

// Serena: reads that only inspect memories, symbols, or server config, plus the
// dashboard open (main-model review 2026-11-05: viewing). activate_project stays
// unlisted, which now DENIES under the zero-popup rule.
const SERENA_ALLOW = new Set([
	"read_memory",
	"list_memories",
	"get_symbols_overview",
	"find_symbol",
	"find_referencing_symbols",
	"search_for_pattern",
	"initial_instructions",
	"get_current_config",
	"check_onboarding_performed",
	"open_dashboard",
]);

// Serena: memory and source mutations, plus onboarding (writes memory files).
const SERENA_DENY = new Set([
	"write_memory",
	"edit_memory",
	"delete_memory",
	"rename_memory",
	"replace_content",
	"replace_symbol_body",
	"insert_after_symbol",
	"insert_before_symbol",
	"rename_symbol",
	"safe_delete_symbol",
	"onboarding",
]);

// GitHub: reads, materialized from the plan's get_/list_/search_ prefix rule
// against the live inventory. The remaining read-named names outside those
// prefixes (issue_read, pull_request_read, ui_get) were reviewed on 2026-11-05
// (main-model review) and confirmed pure reads of GitHub data, so they are
// listed here too.
const GITHUB_ALLOW = new Set([
	"get_commit",
	"get_file_contents",
	"get_label",
	"get_latest_release",
	"get_me",
	"get_release_by_tag",
	"get_tag",
	"get_team_members",
	"get_teams",
	"issue_read",
	"list_branches",
	"list_commits",
	"list_issue_fields",
	"list_issue_types",
	"list_issues",
	"list_pull_requests",
	"list_releases",
	"list_repository_collaborators",
	"list_tags",
	"pull_request_read",
	"search_code",
	"search_commits",
	"search_issues",
	"search_pull_requests",
	"search_repositories",
	"ui_get",
]);

// GitHub: repository mutations. Beyond the create_/delete_/push_ families the
// plan names, update_/add_/*_write/merge/fork names are unambiguously persistent
// mutations and belong in the same deny tier ("never askable").
const GITHUB_DENY = new Set([
	"add_comment_to_pending_review",
	"add_issue_comment",
	"add_reply_to_pull_request_comment",
	"create_branch",
	"create_or_update_file",
	"create_pull_request",
	"create_repository",
	"delete_file",
	"fork_repository",
	"merge_pull_request",
	"push_files",
	"sub_issue_write",
	"issue_write",
	"pull_request_review_write",
	"update_issue_comment",
	"update_pull_request",
	"update_pull_request_branch",
]);

// Supabase: read-named tools (list_/get_/search_) plus generate_typescript_types
// (main-model review 2026-11-05: generates type definitions only, changes no
// data). query_logs is read-named and its description states it runs a read-only
// log query; execute_sql stays denied.
const SUPABASE_ALLOW = new Set([
	"generate_typescript_types",
	"get_advisors",
	"get_cost",
	"get_edge_function",
	"get_organization",
	"get_project",
	"get_project_url",
	"get_publishable_keys",
	"list_branches",
	"list_edge_functions",
	"list_extensions",
	"list_migrations",
	"list_organizations",
	"list_projects",
	"list_tables",
	"query_logs",
	"search_docs",
]);

// Supabase: write-named tools plus every SQL execution tool (SQL cannot be
// classified as a read, per the plan). confirm_cost joins this tier on the
// 2026-11-05 main-model review: it issues the confirmation ID that unlocks
// create_project/create_branch, so it is part of the creation pipeline.
const SUPABASE_DENY = new Set([
	"apply_migration",
	"confirm_cost",
	"create_branch",
	"create_project",
	"delete_branch",
	"delete_feedback",
	"deploy_edge_function",
	"execute_sql",
	"merge_branch",
	"pause_project",
	"rebase_branch",
	"reset_branch",
	"restore_project",
	"submit_feedback",
]);

// Entire servers allowed by user decision 2026-11-05: every tool on every
// playwright server, viewing and interactions alike. playwright5 exists in the
// live inventory alongside playwright..playwright4 and is a playwright server,
// so "every playwright server" covers it (flagged in the evidence inventory).
const PLAYWRIGHT_SERVERS = new Set(["playwright", "playwright2", "playwright3", "playwright4", "playwright5"]);

// Illustrator: getter-named tools plus pure analysis or viewing tools (check/
// find/snapshot/diff families, token extraction, render verification; ruling
// 2026-11-05, main-model review). The final ruling, 2026-11-05, moved three
// flagged names into this tier: open_document (opens a document for viewing)
// and the document-lock mutex pair acquire_document, release_document (session
// handle bookkeeping, no document state changes). Unlisted leftovers
// (select/deselect/convert/checkpoint) deny under the zero-popup rule.
const ILLUSTRATOR_ALLOW = new Set([
	"acquire_document",
	"check_contrast",
	"check_text_consistency",
	"document_diff",
	"extract_design_tokens",
	"find_objects",
	"get_artboards",
	"get_colors",
	"get_document_info",
	"get_document_structure",
	"get_effects",
	"get_guidelines",
	"get_groups",
	"get_images",
	"get_layers",
	"get_overprint_info",
	"get_path_items",
	"get_separation_info",
	"get_selection",
	"get_symbols",
	"get_text_frame_detail",
	"list_checkpoints",
	"list_fonts",
	"list_graphic_styles",
	"list_text_styles",
	"list_text_frames",
	"open_document",
	"preflight_check",
	"release_document",
	"snapshot_document",
	"verify_render",
]);

// Illustrator: document and file mutations (create/modify/place/manage/save/
// export/undo family, arbitrary scripting, destructive checkpoint restore).
const ILLUSTRATOR_DENY = new Set([
	"align_objects",
	"apply_graphic_style",
	"apply_text_style",
	"assign_color_profile",
	"close_document",
	"convert_to_outlines",
	"create_compound_path",
	"create_crop_marks",
	"create_document",
	"create_ellipse",
	"create_gradient",
	"create_guide",
	"create_line",
	"create_path",
	"create_path_text",
	"create_polygon",
	"create_rectangle",
	"create_star",
	"create_text_frame",
	"define_symbol",
	"delete_objects",
	"duplicate_objects",
	"execute_extendscript",
	"export",
	"export_pdf",
	"export_pdf_bleed",
	"export_psd",
	"format_text",
	"group_objects",
	"image_trace",
	"import_svg_as_editable",
	"manage_artboards",
	"manage_datasets",
	"manage_layers",
	"manage_linked_images",
	"manage_swatches",
	"modify_object",
	"move_to_layer",
	"offset_path",
	"pathfinder_op",
	"place_color_chips",
	"place_image",
	"place_object",
	"place_style_guide",
	"place_symbol",
	"replace_color",
	"replace_font",
	"resize_for_variation",
	"restore_checkpoint",
	"safe_export",
	"save_document",
	"set_blend_mode",
	"set_fill_stroke",
	"set_illustrator_version",
	"set_workflow",
	"set_z_order",
	"transform_object",
	"ungroup_objects",
	"undo",
]);

// Photoshop: getter-named tools plus pure analysis or viewing tools (check/
// find/analyze/validate/compare/qa/snapshot/diff/render_preview families,
// open_image, load_design_system; ruling 2026-11-05, main-model review). Unlisted
// leftovers (transient selection state: select_all, select_rectangle, deselect,
// invert_selection) deny under the zero-popup rule. The ruling's acquire/release
// words name no photoshop inventory tools, so nothing is listed for them here.
const PHOTOSHOP_ALLOW = new Set([
	"analyze_layout",
	"brand_check",
	"check_font_available",
	"compare_renders",
	"compare_snapshots",
	"design_qa",
	"detect_overlaps",
	"find_assets",
	"get_active_document_info",
	"get_capabilities",
	"get_document_info",
	"get_history",
	"get_image_dimensions",
	"get_layer_bounds",
	"get_preview",
	"get_selection_info",
	"get_session_info",
	"get_state",
	"get_version",
	"list_datasets",
	"list_design_systems",
	"list_files",
	"list_fonts",
	"list_group_layers",
	"list_layers",
	"load_design_system",
	"open_image",
	"render_preview",
	"validate_layout",
	"visual_hierarchy",
]);

// Photoshop: document and file mutations (every add/create/move/set/adjust/
// apply/transform tool, save/export, undo/redo, arbitrary scripting,
// dataset imports, generation loops).
const PHOTOSHOP_DENY = new Set([
	"add_image",
	"add_rectangle",
	"add_text",
	"add_text_box",
	"adjust_brightness_contrast",
	"adjust_curves",
	"adjust_exposure",
	"adjust_hue_saturation",
	"adjust_vibrance",
	"align_layers",
	"apply_constraints",
	"apply_gaussian_blur",
	"apply_gradient_map",
	"apply_gradient_mask",
	"apply_layer_mask",
	"apply_layer_style",
	"apply_lut",
	"apply_motion_blur",
	"apply_noise",
	"apply_photo_filter",
	"apply_sharpen",
	"auto_contrast",
	"auto_levels",
	"capture_design_system",
	"center_in_canvas",
	"clear_guides",
	"close_document",
	"content_aware_fill",
	"create_component",
	"create_document",
	"create_group",
	"create_guides",
	"create_layer",
	"create_layer_mask",
	"crop_document",
	"delete_layer",
	"delete_layer_mask",
	"desaturate_layer",
	"design_loop",
	"distribute_layers",
	"duplicate_layer",
	"execute_design_plan",
	"execute_script",
	"export_as",
	"export_image",
	"fill_layer",
	"fit_image_to_box",
	"fit_layer_to_document",
	"fit_text",
	"fit_text_to_box",
	"flatten_image",
	"generate_from_datasets",
	"generate_variants",
	"group_layers",
	"image_stack",
	"import_datasets",
	"invert_layer",
	"merge_visible_layers",
	"move_layer",
	"move_layer_down",
	"move_layer_to_group",
	"move_layer_to_position",
	"move_layer_up",
	"place_image",
	"play_action",
	"rasterize_layer",
	"redo",
	"rename_group",
	"rename_layer",
	"render_snapshot",
	"resize_image",
	"resize_layer",
	"restore_checkpoint",
	"rotate_layer",
	"save_checkpoint",
	"save_design_system",
	"save_psd",
	"set_color",
	"set_font",
	"set_layer_blend_mode",
	"set_layer_locked",
	"set_layer_opacity",
	"set_layer_visibility",
	"set_text_alignment",
	"snap_layer_to_grid",
	"snap_to_safe_area",
	"undo",
	"update_text_content",
]);

const SERVER_ALLOW: Record<string, Set<string>> = {
	serena: SERENA_ALLOW,
	github: GITHUB_ALLOW,
	supabase: SUPABASE_ALLOW,
	illustrator: ILLUSTRATOR_ALLOW,
	photoshop: PHOTOSHOP_ALLOW,
};

const SERVER_DENY: Record<string, Set<string>> = {
	serena: SERENA_DENY,
	github: GITHUB_DENY,
	supabase: SUPABASE_DENY,
	illustrator: ILLUSTRATOR_DENY,
	photoshop: PHOTOSHOP_DENY,
};

const SERVER_DENY_REASON: Record<string, string> = {
	serena: "serena mutation (memories or source code)",
	github: "github repository mutation",
	supabase: "supabase mutation (project, schema, or SQL)",
	illustrator: "illustrator document or file mutation",
	photoshop: "photoshop document or file mutation",
};

// The MCP gateway server (the universal "mcp" wrapper): it can reach ANY server
// and therefore cannot be pre-classified. Hard DENY per the zero-popup rule
// (user decision 2026-11-05); use the direct server tools or switch to build mode.
const MCP_GATEWAY_SERVER = "mcp";

// Reason for every verdict that is not an explicit known read or known mutation:
// refused instead of asked, so plan mode never opens a permission popup. Names the
// config onboarding path (plan part 6): a read-only tool the tiers do not know can
// be admitted locally without a code change.
export const CONFIG_PATH_DISPLAY = "~/.pi/agent/planbuild.json";

export const UNCLASSIFIED_REASON =
	`not classified as a read in plan mode; if this tool is read-only, admit it via ${CONFIG_PATH_DISPLAY} (planAllowServers or planAllowTools) or switch to build mode with /mode build`;

// Config onboarding doors (plan part 6). Both keys are optional string arrays;
// anything else (missing, non-array, non-string or empty entries) is ignored.
export interface PlanAllowConfig {
	planAllowServers?: string[];
	planAllowTools?: string[];
}

function asNameList(value: unknown): Set<string> {
	if (!Array.isArray(value)) return new Set<string>();
	const names = new Set<string>();
	for (const entry of value) {
		if (typeof entry === "string" && entry.trim().length > 0) names.add(entry.trim());
	}
	return names;
}

// Consult the config doors BEFORE the built-in tiers. An entry only ever produces
// an allow: if the name sits on the server's built-in deny tier the built-in deny
// wins (the config can never unblock a classified mutation). Unknown servers have
// no deny tier, so planAllowServers admits them wholesale; that is the onboarding
// case the door exists for (add the server here, flip to build once to classify
// its mutations, or keep it here if it is read-only).
export function configAllows(
	server: string,
	name: string,
	config: PlanAllowConfig | undefined,
): { action: McpClass; reason: string } | null {
	if (!config) return null;
	const denyTier = SERVER_DENY[server];
	if (denyTier && denyTier.has(name)) return null;
	if (asNameList(config.planAllowServers).has(server)) {
		return { action: "allow", reason: `${server} admitted as a read server by ${CONFIG_PATH_DISPLAY} planAllowServers` };
	}
	if (asNameList(config.planAllowTools).has(name)) {
		return { action: "allow", reason: `${name} admitted as a read tool by ${CONFIG_PATH_DISPLAY} planAllowTools` };
	}
	return null;
}

const MCP_PROXY_PREFIX = "mcp__";

export function normalizeSubtool(server: string, subtool: string): string {
	let name = subtool.trim();
	if (name.startsWith(MCP_PROXY_PREFIX)) name = name.slice(MCP_PROXY_PREFIX.length);
	const prefix = server + "_";
	if (name.startsWith(prefix) && name.length > prefix.length) name = name.slice(prefix.length);
	return name;
}

// Extraction order per the approved plan: input.tool is the only key the live
// adapter defines (pi-mcp-adapter 2.33.0, namespace-tools.ts envelope {tool, args});
// input.name and input.serverTool do not exist there and are kept as fallbacks.
export function extractSubtool(input: Record<string, unknown>): string | undefined {
	for (const key of ["tool", "name", "serverTool"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return undefined;
}

// Zero popups (user decision 2026-11-05): this function NEVER returns "ask".
// The "ask" variant stays in the McpClass type for typing compatibility only;
// the ask tier is empty by design. Everything that is not a known read, a config
// admission, or a known mutation is a deny. configAllows is consulted first, but
// the gateway check stays ahead of it: no config entry may admit the universal
// wrapper, and a deny-tier name may never be flipped.
export function classifyMcpCall(
	server: string,
	subtool: string | undefined,
	config?: PlanAllowConfig,
): { action: McpClass; reason: string } {
	if (server === MCP_GATEWAY_SERVER) {
		return {
			action: "deny",
			reason: "the mcp gateway wrapper can reach any server and cannot be pre-classified; use direct server tools or build mode",
		};
	}
	if (subtool === undefined || normalizeSubtool(server, subtool).length === 0) {
		return { action: "deny", reason: UNCLASSIFIED_REASON };
	}
	const name = normalizeSubtool(server, subtool);
	const admitted = configAllows(server, name, config);
	if (admitted) return admitted;
	const isPlaywright = PLAYWRIGHT_SERVERS.has(server);
	const allow = SERVER_ALLOW[server];
	if (isPlaywright) {
		return { action: "allow", reason: "playwright server fully allowed in plan mode (viewing and interactions)" };
	}
	if (!allow) {
		return { action: "deny", reason: UNCLASSIFIED_REASON };
	}
	if (allow.has(name)) {
		return { action: "allow", reason: `${server} read-only tool` };
	}
	if (SERVER_DENY[server].has(name)) {
		return { action: "deny", reason: SERVER_DENY_REASON[server] };
	}
	return { action: "deny", reason: UNCLASSIFIED_REASON };
}

// ---------------------------------------------------------------------------
// Non-MPC plan-mode tool gate (strict, zero popups; plan part 2). The old
// catch-all rule evaluation (ask tier plus customRules) is gone: in plan mode a
// non-MPC tool call is either on the explicit read list below or it denies with
// PLAN_MODE_DENY_REASON. The "ask" action does not exist in NonMpcClass, so the
// plan-mode ask path is unreachable by construction (asserted in unit tests).
//
// Structured, input-dependent gates are handled in index.ts BEFORE this name
// classifier runs and never reach it: edit/write (plan paths), bash/powershell
// (read-only shell allowlists), subagent (research-agent names). plan_question
// and plan_exit are also special-cased in index.ts; they are listed here so the
// classifier is total and consistent for every tool name.
// ---------------------------------------------------------------------------

export const PLAN_MODE_READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

// pi-web-access 0.31.0 reading tools, names from the installed package's
// DEFAULT_TOOL_NAMES (runtime truth). web_enable is the package's lazy-activation
// loader on pi >= 0.86.1: the four reading tools register INACTIVE and never
// become callable until it runs, so the loader is allowed as a pure local
// activation toggle (it never searches or fetches anything itself).
export const PLAN_MODE_WEB_TOOLS = new Set(["web_search", "fetch_content", "get_search_content", "source_check", "web_enable"]);

export const PLAN_MODE_DENY_REASON = "not a read tool in plan mode; switch to build mode with /mode build";

// No "ask": the popup path does not exist, mirroring the MCP classifier (zero popups).
export type NonMpcClass = "allow" | "deny";

export function classifyPlanModeTool(toolName: string): { action: NonMpcClass; reason: string } {
	if (PLAN_MODE_READ_TOOLS.has(toolName)) return { action: "allow", reason: "read-only builtin" };
	if (PLAN_MODE_WEB_TOOLS.has(toolName)) return { action: "allow", reason: "pi-web-access reading tool" };
	if (toolName === "plan_question" || toolName === "plan_exit") {
		return { action: "allow", reason: "planbuild own tool" };
	}
	return { action: "deny", reason: PLAN_MODE_DENY_REASON };
}
