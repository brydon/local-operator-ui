import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
	entryPoints: ["src/shared/desktop-companion.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	companionStateFromCatalogue: select,
	companionPreferences,
	clampCompanionPosition,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const catalogue = (...sessions) => ({ result: { sessions } });
const row = (id, code, extra = {}) => ({ id, status: { code }, ...extra });
const unread = { attention: { unseen: true } };

test("gates take precedence over active work and unopened completions", () => {
	const result = select(
		catalogue(
			row("done", "complete", unread),
			row("running", "busy", unread),
			row("gate", "approval"),
		),
	);
	assert.deepEqual(result, {
		mood: "attention",
		label: "Needs you",
		sessionId: "gate",
	});
	assert.equal(select(catalogue(row("ask", "answer"))).mood, "attention");
});
test("a previous completion receipt cannot make an active turn look finished", () => {
	assert.equal(select(catalogue(row("a", "busy", unread))).mood, "working");
	assert.equal(
		select(catalogue(row("a", "complete", unread))).mood,
		"complete",
	);
	assert.equal(
		select(catalogue(row("a", "complete", { attention: { unseen: false } })))
			.mood,
		"idle",
	);
});
test("read failures and unfamiliar status never imply readiness", () => {
	for (const body of [
		null,
		{},
		{ result: {} },
		catalogue(row("a", "future-status")),
		catalogue({ id: "missing" }),
	]) {
		assert.equal(select(body).mood, "offline");
	}
	assert.equal(
		select({ result: { sessions: [], degraded: ["session_liveness"] } }).mood,
		"offline",
	);
	assert.equal(select(catalogue()).mood, "idle");
});
test("archived sessions and acknowledged outcomes do not demand attention", () => {
	assert.equal(
		select(catalogue(row("old", "approval", { archived: true }))).mood,
		"idle",
	);
	assert.equal(
		select(catalogue(row("old", "error", { attention: { unseen: false } })))
			.mood,
		"idle",
	);
	assert.equal(select(catalogue(row("failed", "error", unread))).mood, "error");
	assert.equal(select(catalogue(row("stale", "wedged"))).label, "Check chat");
});
test("interrupted unread work is distinct from an unavailable backend", () => {
	assert.deepEqual(select(catalogue(row("paused", "interrupted", unread))), {
		mood: "attention",
		label: "Paused",
		sessionId: "paused",
	});
});
test("position restoration remains on the selected display, including negative coordinates", () => {
	assert.deepEqual(
		clampCompanionPosition(
			{ x: -3000, y: 5000 },
			{ x: -1920, y: 40, width: 1920, height: 1040 },
		),
		{ x: -1920, y: 860 },
	);
	assert.deepEqual(
		clampCompanionPosition(
			{ x: 9000, y: -100 },
			{ x: 0, y: 24, width: 1440, height: 876 },
		),
		{ x: 1224, y: 24 },
	);
});
test("corrupt preferences cannot move a window to nonfinite coordinates", () => {
	assert.deepEqual(
		companionPreferences({
			enabled: false,
			character: "hoodie",
			position: { x: Number.POSITIVE_INFINITY, y: 3 },
		}),
		{ enabled: false, character: "hoodie" },
	);
	assert.deepEqual(
		companionPreferences({ position: { x: -400.4, y: 50.8 } }).position,
		{ x: -400, y: 51 },
	);
	assert.equal(companionPreferences(null).character, "sprout");
});
