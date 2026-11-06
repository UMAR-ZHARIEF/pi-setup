import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMcpCall,
  classifyPlanModeTool,
  CONFIG_PATH_DISPLAY,
  extractSubtool,
  normalizeSubtool,
  PLAN_MODE_DENY_REASON,
  PLAN_MODE_READ_TOOLS,
  PLAN_MODE_WEB_TOOLS,
  UNCLASSIFIED_REASON,
} from "../classify.ts";

// Names sampled from the live adapter inventory (C:\Users\Guess\.pi\agent\mcp-cache.json).

test("every playwright server allows viewing and interaction tools, bare and prefixed forms", () => {
  const servers = ["playwright", "playwright2", "playwright3", "playwright4", "playwright5"];
  const tools = [
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_evaluate",
    "browser_run_code_unsafe",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_network_requests",
    "browser_handle_dialog",
    "browser_file_upload",
    "browser_press_key",
    "browser_drag",
    "browser_drop",
    "browser_hover",
    "browser_select_option",
    "browser_tabs",
    "browser_wait_for",
    "browser_find",
    "browser_resize",
    "browser_emulate_media",
    "browser_cookie_set",
    "browser_localstorage_set",
    "browser_route",
    "browser_pdf_save",
  ];
  for (const server of servers) {
    for (const tool of tools) {
      const bare = classifyMcpCall(server, tool);
      assert.equal(bare.action, "allow", `${server}.${tool} bare form`);
      const prefixed = classifyMcpCall(server, `${server}_${tool}`);
      assert.equal(prefixed.action, "allow", `${server}.${tool} prefixed form`);
    }
  }
});

test("each serena read allows, in unprefixed and serena-prefixed forms", () => {
  const reads = [
    "read_memory",
    "list_memories",
    "get_symbols_overview",
    "find_symbol",
    "find_referencing_symbols",
    "search_for_pattern",
    "initial_instructions",
    "get_current_config",
    "check_onboarding_performed",
  ];
  for (const read of reads) {
    assert.equal(classifyMcpCall("serena", read).action, "allow", read);
    assert.equal(classifyMcpCall("serena", `serena_${read}`).action, "allow", `serena_${read}`);
  }
});

test("each serena mutator denies with the mutation reason, in both spellings", () => {
  const mutators = [
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
  ];
  for (const mutator of mutators) {
    const bare = classifyMcpCall("serena", mutator);
    assert.equal(bare.action, "deny", mutator);
    assert.match(bare.reason, /serena mutation/);
    const prefixed = classifyMcpCall("serena", `serena_${mutator}`);
    assert.equal(prefixed.action, "deny", `serena_${mutator}`);
    assert.match(prefixed.reason, /serena mutation/);
  }
});

test("the live observed call shape classifies as deny", () => {
  const verdict = classifyMcpCall("serena", "serena_edit_memory");
  assert.equal(verdict.action, "deny");
  assert.equal(classifyMcpCall("serena", "mcp__serena_edit_memory").action, "deny");
});

test("github reads allow via the materialized get_/list_/search_ inventory names", () => {
  const reads = [
    "get_me",
    "get_file_contents",
    "get_commit",
    "list_issues",
    "list_pull_requests",
    "list_commits",
    "search_repositories",
    "search_code",
    "search_issues",
  ];
  for (const read of reads) {
    assert.equal(classifyMcpCall("github", read).action, "allow", read);
    assert.equal(classifyMcpCall("github", `github_${read}`).action, "allow", `github_${read}`);
  }
});

test("github create/delete/push/update/add/write/merge/fork mutations deny", () => {
  const mutations = [
    "create_branch",
    "create_or_update_file",
    "create_pull_request",
    "create_repository",
    "delete_file",
    "push_files",
    "update_issue_comment",
    "update_pull_request",
    "update_pull_request_branch",
    "add_issue_comment",
    "add_comment_to_pending_review",
    "add_reply_to_pull_request_comment",
    "issue_write",
    "pull_request_review_write",
    "sub_issue_write",
    "merge_pull_request",
    "fork_repository",
  ];
  for (const mutation of mutations) {
    const verdict = classifyMcpCall("github", mutation);
    assert.equal(verdict.action, "deny", mutation);
    assert.match(verdict.reason, /github repository mutation/);
  }
});

test("github read-named names outside the prefix rule allow after the 2026-11-05 review", () => {
  for (const name of ["issue_read", "pull_request_read", "ui_get"]) {
    assert.equal(classifyMcpCall("github", name).action, "allow", name);
    assert.equal(classifyMcpCall("github", `github_${name}`).action, "allow", `github_${name}`);
  }
});

test("supabase read-named tools allow and write or SQL tools deny", () => {
  const reads = ["list_tables", "list_projects", "list_migrations", "get_project", "get_cost", "get_advisors", "search_docs", "query_logs"];
  for (const read of reads) {
    assert.equal(classifyMcpCall("supabase", read).action, "allow", read);
  }
  const mutations = [
    "execute_sql",
    "apply_migration",
    "create_project",
    "create_branch",
    "delete_branch",
    "merge_branch",
    "reset_branch",
    "rebase_branch",
    "pause_project",
    "restore_project",
    "deploy_edge_function",
    "submit_feedback",
    "delete_feedback",
  ];
  for (const mutation of mutations) {
    const verdict = classifyMcpCall("supabase", mutation);
    assert.equal(verdict.action, "deny", mutation);
    assert.match(verdict.reason, /supabase mutation/);
  }
});

test("illustrator getters allow and document mutations deny", () => {
  const reads = ["get_document_info", "get_layers", "get_selection", "list_fonts", "list_checkpoints", "get_symbols"];
  for (const read of reads) {
    assert.equal(classifyMcpCall("illustrator", read).action, "allow", read);
  }
  const mutations = [
    "create_rectangle",
    "create_document",
    "modify_object",
    "save_document",
    "close_document",
    "delete_objects",
    "export",
    "export_pdf",
    "export_psd",
    "safe_export",
    "execute_extendscript",
    "undo",
    "image_trace",
    "restore_checkpoint",
    "set_workflow",
  ];
  for (const mutation of mutations) {
    const verdict = classifyMcpCall("illustrator", mutation);
    assert.equal(verdict.action, "deny", mutation);
    assert.match(verdict.reason, /illustrator document or file mutation/);
  }
});

test("photoshop getters allow and document mutations deny", () => {
  const reads = ["get_document_info", "get_state", "get_preview", "get_version", "list_layers", "list_fonts", "list_files"];
  for (const read of reads) {
    assert.equal(classifyMcpCall("photoshop", read).action, "allow", read);
  }
  const mutations = [
    "create_document",
    "add_text",
    "move_layer",
    "delete_layer",
    "save_psd",
    "export_image",
    "export_as",
    "execute_script",
    "execute_design_plan",
    "design_loop",
    "update_text_content",
    "flatten_image",
    "image_stack",
    "undo",
    "redo",
    "restore_checkpoint",
    "save_design_system",
    "generate_variants",
  ];
  for (const mutation of mutations) {
    const verdict = classifyMcpCall("photoshop", mutation);
    assert.equal(verdict.action, "deny", mutation);
    assert.match(verdict.reason, /photoshop document or file mutation/);
  }
});

test("the mcp gateway server hard-denies for any subtool (zero popups)", () => {
  for (const subtool of ["proxy_call", "vision_describe_image", "serena_read_memory", "mcp__serena_read_memory"]) {
    const verdict = classifyMcpCall("mcp", subtool);
    assert.equal(verdict.action, "deny", subtool);
    assert.match(verdict.reason, /cannot be pre-classified/);
  }
  assert.equal(classifyMcpCall("mcp", undefined).action, "deny");
  assert.equal(classifyMcpCall("mcp", "").action, "deny");
});

test("unknown server denies even for a read-sounding tool (zero popups)", () => {
  const vision = classifyMcpCall("vision", "vision_describe_image");
  assert.equal(vision.action, "deny");
  assert.equal(vision.reason, UNCLASSIFIED_REASON);
  const noServer = classifyMcpCall("notarealserver", "get_everything");
  assert.equal(noServer.action, "deny");
  assert.equal(noServer.reason, UNCLASSIFIED_REASON);
});

test("unknown sub-tool on a known server denies with the unclassified reason", () => {
  for (const [server, subtool] of [
    ["serena", "drink_memory"],
    ["github", "delete_everything"],
    ["illustrator", "resize_everything"],
    ["photoshop", "analyze_everything"],
  ] as const) {
    const verdict = classifyMcpCall(server, subtool);
    assert.equal(verdict.action, "deny", subtool);
    assert.equal(verdict.reason, UNCLASSIFIED_REASON, subtool);
  }
});

test("main-model review 2026-11-05 moved the flagged names to their ruled tiers", () => {
  // github: the three read-named names join the allow tier (covered above).
  assert.equal(classifyMcpCall("github", "github_issue_read").action, "allow");
  // serena: dashboard open is pure viewing; activate_project is unlisted and
  // now denies under the zero-popup rule (no ask tier anymore).
  assert.equal(classifyMcpCall("serena", "open_dashboard").action, "allow");
  assert.equal(classifyMcpCall("serena", "activate_project").action, "deny");
  assert.equal(classifyMcpCall("serena", "activate_project").reason, UNCLASSIFIED_REASON);
  // supabase: type generation allows; the cost confirmation gates creation, deny.
  assert.equal(classifyMcpCall("supabase", "generate_typescript_types").action, "allow");
  const cost = classifyMcpCall("supabase", "confirm_cost");
  assert.equal(cost.action, "deny");
  assert.match(cost.reason, /supabase mutation/);
  // illustrator/photoshop: sampled pure analysis names allow.
  assert.equal(classifyMcpCall("illustrator", "check_contrast").action, "allow");
  assert.equal(classifyMcpCall("photoshop", "analyze_layout").action, "allow");
  // transient selection state is unlisted and now denies; the final ruling
  // (2026-11-05) moved open_document and the document lock pair to the allow tier.
  assert.equal(classifyMcpCall("photoshop", "select_all").action, "deny");
  assert.equal(classifyMcpCall("illustrator", "select_objects").action, "deny");
  assert.equal(classifyMcpCall("illustrator", "open_document").action, "allow");
  assert.equal(classifyMcpCall("illustrator", "acquire_document").action, "allow");
});

test("one sample per previous allow and deny tier is unchanged", () => {
  assert.equal(classifyMcpCall("serena", "find_symbol").action, "allow");
  assert.equal(classifyMcpCall("serena", "edit_memory").reason, "serena mutation (memories or source code)");
  assert.equal(classifyMcpCall("github", "get_file_contents").action, "allow");
  assert.equal(classifyMcpCall("github", "push_files").reason, "github repository mutation");
  assert.equal(classifyMcpCall("supabase", "list_tables").action, "allow");
  assert.equal(classifyMcpCall("supabase", "execute_sql").reason, "supabase mutation (project, schema, or SQL)");
  assert.equal(classifyMcpCall("illustrator", "get_layers").action, "allow");
  assert.equal(classifyMcpCall("illustrator", "save_document").reason, "illustrator document or file mutation");
  assert.equal(classifyMcpCall("photoshop", "get_document_info").action, "allow");
  assert.equal(classifyMcpCall("photoshop", "save_psd").reason, "photoshop document or file mutation");
  assert.equal(classifyMcpCall("playwright", "browser_click").action, "allow");
});

test("missing or empty sub-tool on a known server denies (zero popups)", () => {
  for (const subtool of [undefined, "", "   "] as const) {
    const verdict = classifyMcpCall("serena", subtool);
    assert.equal(verdict.action, "deny");
    assert.equal(verdict.reason, UNCLASSIFIED_REASON);
  }
});

test("classifyMcpCall never returns ask (empty ask tier by design)", () => {
  const servers = ["mcp", "serena", "github", "supabase", "illustrator", "photoshop", "playwright", "playwright5", "vision", "notarealserver"];
  const subtools = [undefined, "", "find_symbol", "edit_memory", "totally_unknown", "mcp__serena_find_symbol"];
  for (const server of servers) {
    for (const subtool of subtools) {
      assert.notEqual(classifyMcpCall(server, subtool).action, "ask", `${server}.${subtool}`);
    }
  }
});

test("extractSubtool reads input.tool, then input.name, then input.serverTool", () => {
  assert.equal(extractSubtool({ tool: "serena_edit_memory" }), "serena_edit_memory");
  assert.equal(extractSubtool({ name: "edit_memory" }), "edit_memory");
  assert.equal(extractSubtool({ serverTool: "edit_memory" }), "edit_memory");
  assert.equal(extractSubtool({ tool: "a", name: "b" }), "a");
  assert.equal(extractSubtool({ name: "b", serverTool: "c" }), "b");
  assert.equal(extractSubtool({ tool: "", name: "b" }), "b");
  assert.equal(extractSubtool({ tool: 42, name: "b" }), "b");
  assert.equal(extractSubtool({ args: { tool: "nested" } }), undefined);
  assert.equal(extractSubtool({}), undefined);
});

test("normalizeSubtool strips mcp__ and server prefixes once, exact otherwise", () => {
  assert.equal(normalizeSubtool("serena", "edit_memory"), "edit_memory");
  assert.equal(normalizeSubtool("serena", "serena_edit_memory"), "edit_memory");
  assert.equal(normalizeSubtool("serena", "mcp__serena_edit_memory"), "edit_memory");
  assert.equal(normalizeSubtool("playwright2", "playwright2_browser_click"), "browser_click");
  assert.equal(normalizeSubtool("serena", "memory_write"), "memory_write");
  assert.equal(normalizeSubtool("github", "serena_edit_memory"), "serena_edit_memory");
});

// ---------------------------------------------------------------------------
// Config onboarding doors (plan part 6): planAllowServers and planAllowTools,
// consulted before the built-in tiers but never unblocking a classified mutation.
// ---------------------------------------------------------------------------

test("planAllowServers admits an unknown server wholesale (onboarding door)", () => {
  const verdict = classifyMcpCall("vision", "vision_describe_image", { planAllowServers: ["vision"] });
  assert.equal(verdict.action, "allow");
  assert.match(verdict.reason, /planAllowServers/);
  assert.match(verdict.reason, /planbuild\.json/);
  // Whole server: every tool name on it passes, prefixed spellings included.
  assert.equal(classifyMcpCall("vision", "vision_list_things", { planAllowServers: ["vision"] }).action, "allow");
  assert.equal(classifyMcpCall("vision", "mcp__vision_describe_image", { planAllowServers: ["vision"] }).action, "allow");
});

test("planAllowTools admits an individual tool on a known or unknown server", () => {
  const known = classifyMcpCall("serena", "drink_memory", { planAllowTools: ["drink_memory"] });
  assert.equal(known.action, "allow");
  assert.match(known.reason, /planAllowTools/);
  // Normalized prefixed spellings match the same entry.
  assert.equal(classifyMcpCall("serena", "serena_drink_memory", { planAllowTools: ["drink_memory"] }).action, "allow");
  assert.equal(classifyMcpCall("notarealserver", "get_everything", { planAllowTools: ["get_everything"] }).action, "allow");
});

test("config entries never flip a deny-tier name (classified mutations stay denied)", () => {
  const bothDoors = { planAllowServers: ["serena", "github", "supabase"], planAllowTools: ["edit_memory", "push_files", "execute_sql"] };
  assert.equal(classifyMcpCall("serena", "edit_memory", bothDoors).action, "deny");
  assert.match(classifyMcpCall("serena", "edit_memory", bothDoors).reason, /serena mutation/);
  assert.equal(classifyMcpCall("github", "push_files", bothDoors).action, "deny");
  assert.match(classifyMcpCall("github", "push_files", bothDoors).reason, /github repository mutation/);
  assert.equal(classifyMcpCall("supabase", "execute_sql", bothDoors).action, "deny");
  // Prefixed spellings of a deny-tier name stay denied too.
  assert.equal(classifyMcpCall("serena", "serena_edit_memory", bothDoors).action, "deny");
});

test("the mcp gateway is never admittable via config", () => {
  const verdict = classifyMcpCall("mcp", "serena_read_memory", {
    planAllowServers: ["mcp"],
    planAllowTools: ["serena_read_memory", "read_memory"],
  });
  assert.equal(verdict.action, "deny");
  assert.match(verdict.reason, /cannot be pre-classified/);
});

test("planAllowServers on a known server admits unclassified names but not deny-tier names", () => {
  // illustrator select_objects is unclassified (no tier lists it): the server door admits it.
  const admitted = classifyMcpCall("illustrator", "select_objects", { planAllowServers: ["illustrator"] });
  assert.equal(admitted.action, "allow");
  assert.match(admitted.reason, /planAllowServers/);
  // A classified mutation on the same server stays denied.
  const mutation = classifyMcpCall("illustrator", "save_document", { planAllowServers: ["illustrator"] });
  assert.equal(mutation.action, "deny");
  assert.match(mutation.reason, /illustrator document or file mutation/);
});

test("invalid or hostile config values are ignored safely", () => {
  // Non-array values, non-string entries, empty and whitespace-only entries.
  const bad = {
    planAllowServers: "serena" as unknown as string[],
    planAllowTools: [42, null, "", "   ", {}] as unknown as string[],
  };
  assert.equal(classifyMcpCall("serena", "find_symbol", bad).action, "allow"); // built-in tier, not config
  assert.equal(classifyMcpCall("serena", "drink_memory", bad).reason, UNCLASSIFIED_REASON);
  assert.equal(classifyMcpCall("vision", "vision_describe_image", bad).reason, UNCLASSIFIED_REASON);
  assert.equal(classifyMcpCall("serena", "find_symbol", undefined).action, "allow");
  assert.equal(classifyMcpCall("serena", "edit_memory", undefined).action, "deny");
});

test("config entries match exactly after trimming, never by prefix", () => {
  const config = { planAllowTools: [" find_symbol "] };
  assert.equal(classifyMcpCall("serena", "find_symbol", config).action, "allow");
  assert.equal(classifyMcpCall("serena", "find_symbol_extra", config).reason, UNCLASSIFIED_REASON);
  const servers = { planAllowServers: [" serena "] };
  assert.equal(classifyMcpCall("serena", "drink_memory", servers).action, "allow");
  assert.equal(classifyMcpCall("serena2", "drink_memory", servers).reason, UNCLASSIFIED_REASON);
});

// ---------------------------------------------------------------------------
// Non-MPC plan-mode strict gate (plan part 2): known reads allow, everything
// else denies with the switch message, ask is unreachable by construction.
// ---------------------------------------------------------------------------

test("the read-only builtins allow silently", () => {
  for (const name of ["read", "grep", "find", "ls"]) {
    const verdict = classifyPlanModeTool(name);
    assert.equal(verdict.action, "allow", name);
    assert.ok(PLAN_MODE_READ_TOOLS.has(name), name);
  }
});

test("the four pi-web-access reading tools plus the web_enable loader allow silently", () => {
  // Runtime names from pi-web-access 0.31.0 DEFAULT_TOOL_NAMES; web_enable is the
  // lazy-activation loader without which the four reading tools never become callable.
  for (const name of ["web_search", "fetch_content", "get_search_content", "source_check", "web_enable"]) {
    const verdict = classifyPlanModeTool(name);
    assert.equal(verdict.action, "allow", name);
    assert.ok(PLAN_MODE_WEB_TOOLS.has(name), name);
  }
});

test("planbuild own tools allow by name", () => {
  for (const name of ["plan_question", "plan_exit"]) {
    assert.equal(classifyPlanModeTool(name).action, "allow", name);
  }
});

test("bg, fusion, subagent-management, gateway and unknown tools deny with the switch message", () => {
  const denied = [
    // pi-background-tasks 2.6.2 (runtime names)
    "bg_run", "bg_run_pi_attested", "bg_status", "bg_logs", "bg_kill", "bg_delegate", "bg_result",
    "fusion_reason", "fusion_investigate", "fusion_research", "fusion_validate", "delegate_read_artifact",
    // pi-subagents 0.71.0 (runtime names)
    "subagents_enable", "bg_wait", "subagent_supervisor", "contact_supervisor",
    // pi-mcp-adapter 2.33.0 (non-proxy surfaces)
    "mcpScript", "mcp",
    // todo tools: rpiv-todo registers "todo"; "todowrite" does not exist in pi 0.86.1,
    // both land in the same catch-all
    "todo", "todowrite",
    // anything unknown, read-sounding or not
    "webfetch", "future_read_thing", "archive_lookup",
  ];
  for (const name of denied) {
    const verdict = classifyPlanModeTool(name);
    assert.equal(verdict.action, "deny", name);
    assert.equal(verdict.reason, PLAN_MODE_DENY_REASON, name);
  }
});

test("the strict deny reason is exactly the approved switch message", () => {
  assert.equal(PLAN_MODE_DENY_REASON, "not a read tool in plan mode; switch to build mode with /mode build");
});

test("structured tools are gated input-dependently upstream and never name-allowed", () => {
  // edit/write/bash/powershell/subagent never reach classifyPlanModeTool (index.ts
  // handles them first with path, command, and agent-name checks). The name
  // classifier must not silently allow them either.
  for (const name of ["edit", "write", "bash", "powershell", "subagent"]) {
    assert.equal(classifyPlanModeTool(name).action, "deny", name);
    assert.ok(!PLAN_MODE_READ_TOOLS.has(name), name);
    assert.ok(!PLAN_MODE_WEB_TOOLS.has(name), name);
  }
});

test("classifyPlanModeTool never returns ask: the plan-mode popup path is unreachable", () => {
  const names = [
    "read", "grep", "find", "ls", "edit", "write", "bash", "powershell",
    "web_search", "fetch_content", "get_search_content", "source_check", "web_enable",
    "subagent", "subagents_enable", "bg_run", "bg_delegate", "bg_result", "bg_status", "bg_logs", "bg_kill", "bg_wait",
    "bg_run_pi_attested", "subagent_supervisor", "contact_supervisor",
    "fusion_reason", "fusion_investigate", "fusion_research", "fusion_validate", "delegate_read_artifact",
    "mcpScript", "mcp", "todo", "todowrite", "plan_question", "plan_exit",
    "something_unheard_of",
  ];
  for (const name of names) {
    const action = classifyPlanModeTool(name).action;
    assert.ok(action === "allow" || action === "deny", `${name}: ${action}`);
  }
});

test("the unclassified MCP denial names the onboarding config path", () => {
  assert.equal(CONFIG_PATH_DISPLAY, "~/.pi/agent/planbuild.json");
  assert.match(UNCLASSIFIED_REASON, /planbuild\.json/);
  assert.match(UNCLASSIFIED_REASON, /planAllowServers or planAllowTools/);
  assert.match(UNCLASSIFIED_REASON, /switch to build mode with \/mode build/);
  assert.equal(classifyMcpCall("notarealserver", "get_everything").reason, UNCLASSIFIED_REASON);
});
