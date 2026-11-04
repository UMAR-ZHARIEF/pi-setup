// planbuild MCP sub-command classifier: pure module, no Pi imports.
//
// Why: in plan mode, MCP tool-server calls arrive as namespace proxies named
// "mcp__<server>" with an input envelope {tool, args} (pi-mcp-adapter
// namespace-tools.ts). The rule engine only ever sees the proxy name, so every
// serena/github/... call looked identical to the gate. This module classifies the
// sub-command into allow (silent), deny (hard block with a switch-to-build
// message, never a popup), or ask (only genuinely unknown tools; per the approved
// design in .pi/plans/planbuild-mutating-gate.md).
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

export type McpClass = "allow" | "deny" | "ask";

// Serena: reads that only inspect memories, symbols, or server config, plus the
// dashboard open (main-model review 2026-11-05: viewing). activate_project stays
// unlisted (ask, transient or unclear).
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
// handle bookkeeping, no document state changes). Ask-tier leftovers are
// transient or unclear: select/deselect/convert/checkpoint.
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
// open_image, load_design_system; ruling 2026-11-05, main-model review). Ask-tier
// leftovers are transient selection state: select_all, select_rectangle,
// deselect, invert_selection. The ruling's acquire/release words name no
// photoshop inventory tools, so nothing is listed for them here.
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

export function classifyMcpCall(server: string, subtool: string | undefined): { action: McpClass; reason: string } {
	const isPlaywright = PLAYWRIGHT_SERVERS.has(server);
	const allow = SERVER_ALLOW[server];
	if (!allow && !isPlaywright) {
		return { action: "ask", reason: "unknown MCP server (not classified)" };
	}
	if (subtool === undefined || normalizeSubtool(server, subtool).length === 0) {
		return { action: "ask", reason: "missing sub-command on known MCP server" };
	}
	if (isPlaywright) {
		return { action: "allow", reason: "playwright server fully allowed in plan mode (viewing and interactions)" };
	}
	const name = normalizeSubtool(server, subtool);
	if (allow.has(name)) {
		return { action: "allow", reason: `${server} read-only tool` };
	}
	if (SERVER_DENY[server].has(name)) {
		return { action: "deny", reason: SERVER_DENY_REASON[server] };
	}
	return { action: "ask", reason: "unknown sub-tool on known MCP server (not classified)" };
}
