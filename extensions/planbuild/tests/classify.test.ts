import test from "node:test";
import assert from "node:assert/strict";
import { classifyMcpCall, extractSubtool, normalizeSubtool } from "../classify.ts";

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

test("unknown server asks even for a read-sounding tool", () => {
  assert.equal(classifyMcpCall("vision", "vision_describe_image").action, "ask");
  assert.equal(classifyMcpCall("notarealserver", "get_everything").action, "ask");
});

test("unknown sub-tool on a known server asks", () => {
  assert.equal(classifyMcpCall("serena", "drink_memory").action, "ask");
  assert.equal(classifyMcpCall("github", "delete_everything").action, "ask");
  assert.equal(classifyMcpCall("illustrator", "resize_everything").action, "ask");
  assert.equal(classifyMcpCall("photoshop", "analyze_everything").action, "ask");
});

test("main-model review 2026-11-05 moves the flagged ask names to their ruled tiers", () => {
  // github: the three read-named names join the allow tier (covered above).
  assert.equal(classifyMcpCall("github", "github_issue_read").action, "allow");
  // serena: dashboard open is pure viewing; activate_project stays ask.
  assert.equal(classifyMcpCall("serena", "open_dashboard").action, "allow");
  assert.equal(classifyMcpCall("serena", "activate_project").action, "ask");
  // supabase: type generation allows; the cost confirmation gates creation, deny.
  assert.equal(classifyMcpCall("supabase", "generate_typescript_types").action, "allow");
  const cost = classifyMcpCall("supabase", "confirm_cost");
  assert.equal(cost.action, "deny");
  assert.match(cost.reason, /supabase mutation/);
  // illustrator/photoshop: sampled pure analysis names allow.
  assert.equal(classifyMcpCall("illustrator", "check_contrast").action, "allow");
  assert.equal(classifyMcpCall("photoshop", "analyze_layout").action, "allow");
  // transient selection state stays ask; the final ruling (2026-11-05) moved
  // open_document and the document lock pair to the allow tier.
  assert.equal(classifyMcpCall("photoshop", "select_all").action, "ask");
  assert.equal(classifyMcpCall("illustrator", "select_objects").action, "ask");
  assert.equal(classifyMcpCall("illustrator", "open_document").action, "allow");
  assert.equal(classifyMcpCall("illustrator", "acquire_document").action, "allow");
});

test("missing or empty sub-tool on a known server asks", () => {
  assert.equal(classifyMcpCall("serena", undefined).action, "ask");
  assert.equal(classifyMcpCall("serena", "").action, "ask");
  assert.equal(classifyMcpCall("serena", "   ").action, "ask");
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
