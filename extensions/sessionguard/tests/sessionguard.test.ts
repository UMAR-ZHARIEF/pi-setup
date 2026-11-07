import test from "node:test";
import assert from "node:assert/strict";
import {
	decideRecovery,
	formatCheckReport,
	formatRecoveryNotice,
	runGuardStep,
	shouldAttemptReload,
	snapshotSession,
	type SessionSnapshot,
} from "../guard.ts";

function snap(leafId: string | null, entryCount: number, lastTimestamp: string | null = null): SessionSnapshot {
	return { leafId, entryCount, lastTimestamp };
}

// ---------------------------------------------------------------------------
// decideRecovery: the compare-and-notify decision.
// ---------------------------------------------------------------------------

test("gained entries notifies with N and the exact notice line", () => {
	const decision = decideRecovery(snap("leaf-a", 1205), snap("leaf-b", 1305));
	assert.equal(decision.notify, true);
	assert.equal(decision.gainedEntries, 100);
	assert.equal(decision.message, formatRecoveryNotice(100));
	assert.match(decision.message as string, /recovered 100 newer entries/);
	assert.match(decision.message as string, /resumed from the complete state\.$/);
});

test("single-entry gain still notifies", () => {
	const decision = decideRecovery(snap("leaf-a", 2), snap("leaf-b", 3));
	assert.equal(decision.notify, true);
	assert.equal(decision.gainedEntries, 1);
});

test("unchanged state stays silent (same count, same leaf)", () => {
	const decision = decideRecovery(snap("leaf-a", 42), snap("leaf-a", 42));
	assert.equal(decision.notify, false);
	assert.equal(decision.gainedEntries, 0);
	assert.equal(decision.message, null);
});

test("leaf moved onto a different chain with the same count still notifies", () => {
	const decision = decideRecovery(snap("leaf-old", 42), snap("leaf-new", 42));
	assert.equal(decision.notify, true);
	assert.equal(decision.gainedEntries, 0);
	assert.match(decision.message as string, /^sessionguard: recovered 0 newer entries/);
});

test("a shrunken count never notifies (unexpected state, caller logs)", () => {
	const decision = decideRecovery(snap("leaf-a", 10), snap("leaf-b", 4));
	assert.equal(decision.notify, false);
	assert.equal(decision.gainedEntries, -6);
});

test("null leaf before or after is handled without crashing", () => {
	assert.equal(decideRecovery(snap(null, 2), snap("leaf-b", 3)).notify, true);
	assert.equal(decideRecovery(snap("leaf-a", 2), snap(null, 2)).notify, false);
	assert.equal(decideRecovery(snap(null, 1), snap(null, 1)).notify, false);
});

// ---------------------------------------------------------------------------
// shouldAttemptReload: the skip guards (header-only, no file, unflushed).
// ---------------------------------------------------------------------------

test("no session file skips (ephemeral session)", () => {
	assert.equal(shouldAttemptReload({ sessionFile: undefined, entryCount: 9, fileExists: false, flushed: true }), "no-session-file");
	assert.equal(shouldAttemptReload({ sessionFile: null, entryCount: 9, fileExists: false, flushed: true }), "no-session-file");
});

test("header-only session skips (brand-new session, nothing to recover)", () => {
	assert.equal(shouldAttemptReload({ sessionFile: "C:/tmp/s.jsonl", entryCount: 1, fileExists: true, flushed: true }), "header-only");
	assert.equal(shouldAttemptReload({ sessionFile: "C:/tmp/s.jsonl", entryCount: 0, fileExists: true, flushed: true }), "header-only");
});

test("missing file skips (new session never flushed to disk)", () => {
	assert.equal(shouldAttemptReload({ sessionFile: "C:/tmp/s.jsonl", entryCount: 9, fileExists: false, flushed: true }), "file-missing");
});

test("unflushed memory skips (reload would drop in-memory entries)", () => {
	assert.equal(shouldAttemptReload({ sessionFile: "C:/tmp/s.jsonl", entryCount: 9, fileExists: true, flushed: false }), "unflushed");
});

test("a real session with a flushed file attempts the reload", () => {
	assert.equal(shouldAttemptReload({ sessionFile: "C:/tmp/s.jsonl", entryCount: 1205, fileExists: true, flushed: true }), null);
});

// ---------------------------------------------------------------------------
// snapshotSession: before/after capture shape.
// ---------------------------------------------------------------------------

test("snapshot captures leaf, count, and the last entry timestamp", () => {
	const entries = [{ timestamp: "2026-11-07T11:06:00.000Z" }, { timestamp: "2026-11-07T11:51:40.000Z" }];
	const snap1 = snapshotSession(entries, "leaf-b");
	assert.equal(snap1.leafId, "leaf-b");
	assert.equal(snap1.entryCount, 2);
	assert.equal(snap1.lastTimestamp, "2026-11-07T11:51:40.000Z");
});

test("snapshot tolerates missing timestamps and empty entries", () => {
	const noTime = snapshotSession([{}], "leaf-a");
	assert.equal(noTime.lastTimestamp, null);
	assert.equal(noTime.entryCount, 1);
	const empty = snapshotSession([], null);
	assert.equal(empty.leafId, null);
	assert.equal(empty.entryCount, 0);
	assert.equal(empty.lastTimestamp, null);
});

// ---------------------------------------------------------------------------
// runGuardStep: any error in the check stays silent and never propagates.
// ---------------------------------------------------------------------------

test("runGuardStep returns the value on success", () => {
	const result = runGuardStep(() => 7);
	assert.deepEqual(result, { ok: true, value: 7 });
});

test("runGuardStep swallows throws as ok:false so startup never breaks", () => {
	const result = runGuardStep(() => {
		throw new Error("disk on fire");
	});
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(String(result.error), /disk on fire/);
});

// ---------------------------------------------------------------------------
// formatRecoveryNotice and the /sessionguard report.
// ---------------------------------------------------------------------------

test("notice line matches the mission wording exactly", () => {
	assert.equal(
		formatRecoveryNotice(3),
		"sessionguard: recovered 3 newer entries the initial load missed; resumed from the complete state.",
	);
});

test("report with no recorded check says so", () => {
	assert.match(formatCheckReport(null), /no check recorded yet/);
});

test("report of a recovery shows leaf before/after, gain, and timestamp", () => {
	const report = formatCheckReport({
		file: "C:/tmp/s.jsonl",
		reason: "startup",
		outcome: "recovered",
		before: snap("leaf-a", 1205, "2026-11-07T11:07:00.000Z"),
		after: snap("leaf-b", 1305, "2026-11-07T11:51:40.000Z"),
		gainedEntries: 100,
		checkedAt: "2026-11-07T11:52:00.000Z",
	});
	assert.match(report, /reason: startup/);
	assert.match(report, /leaf before: leaf-a/);
	assert.match(report, /leaf after: leaf-b/);
	assert.match(report, /entries before: 1205/);
	assert.match(report, /entries after: 1305/);
	assert.match(report, /entries gained: 100/);
	assert.match(report, /last entry: 2026-11-07T11:51:40\.000Z/);
	assert.equal(report.includes("reload skipped"), false);
});

test("report of a skip shows the skip reason and no snapshots", () => {
	const report = formatCheckReport({
		file: "C:/tmp/new.jsonl",
		reason: "new",
		outcome: "header-only",
		before: null,
		after: null,
		gainedEntries: 0,
		checkedAt: "2026-11-07T12:00:00.000Z",
	});
	assert.match(report, /reload skipped: header-only/);
	assert.match(report, /entries gained: 0/);
	assert.equal(report.includes("leaf before"), false);
});

test("report of the silent normal case shows snapshots and zero gain", () => {
	const report = formatCheckReport({
		file: "C:/tmp/s.jsonl",
		reason: "resume",
		outcome: "silent",
		before: snap("leaf-a", 42, "2026-11-07T10:00:00.000Z"),
		after: snap("leaf-a", 42, "2026-11-07T10:00:00.000Z"),
		gainedEntries: 0,
		checkedAt: "2026-11-07T12:00:00.000Z",
	});
	assert.match(report, /leaf before: leaf-a/);
	assert.match(report, /leaf after: leaf-a/);
	assert.match(report, /entries gained: 0/);
	assert.equal(report.includes("reload skipped"), false);
});
