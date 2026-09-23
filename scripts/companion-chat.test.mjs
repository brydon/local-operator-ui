import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/companion-chat.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { CompanionChatService } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const ID = "abcdef123456";
const OTHER_ID = "fedcba654321";
const receipt = (result, status = 200) => ({
	status,
	body: { result },
});
const admitted = ({ requestId }) =>
	receipt({ status: "admitted", command_id: requestId });
const row = (id, role, text, extra = {}) => ({
	id,
	type: "message",
	payload: { role, content: [{ text }], ...extra },
});
const frame = ({
	sessionId = ID,
	history = [],
	cold_reason = null,
	...state
} = {}) =>
	receipt({
		session_id: sessionId,
		payload: {
			cold_reason,
			history: { entries: history },
			frontend: {
				snapshot: {
					session_id: sessionId,
					epoch: "epoch",
					conversation_title: "A small chat",
					streaming: false,
					pending_gate: null,
					live_events: [],
					generation: 0,
					last_turn_outcome: "",
					...state,
				},
			},
		},
	});

function fixture() {
	const calls = [];
	const changes = [];
	let current = frame();
	let override;
	const service = new CompanionChatService({
		cwd: "/a/known/directory",
		onChange: (snapshot) => changes.push(snapshot),
		requestDesktop: async (input) => {
			calls.push(input);
			if (override) {
				const handled = await override(input);
				if (handled !== undefined) return handled;
			}
			if (input.op === "sessions.create") return receipt({ session_id: ID });
			if (input.op === "sessions.get") return current;
			if (input.op === "sessions.message") {
				current = frame({
					history: [
						row(input.requestId, "user", input.text),
						row("answer", "assistant", "Hello back"),
					],
					generation: 1,
					last_turn_outcome: "completed",
				});
				return admitted(input);
			}
			throw new Error(`Unexpected operation ${input.op}`);
		},
	});
	return {
		service,
		calls,
		changes,
		messages: () => calls.filter((call) => call.op === "sessions.message"),
		setFrame: (value) => {
			current = value;
		},
		handle: (value) => {
			override = value;
		},
	};
}

test("chat creates lazily with defaults and displays accepted prose", async () => {
	const f = fixture();
	await f.service.open();
	await f.service.refresh();
	assert.equal(f.calls.length, 0);
	const sent = await f.service.send("Hello");
	assert.equal(sent.accepted, true);
	assert.deepEqual(Object.keys(f.calls[0]).sort(), ["cwd", "op", "requestId"]);
	assert.equal(f.calls[0].cwd, "/a/known/directory");
	assert.equal(f.messages()[0].mode, "prompt");
	assert.equal(sent.snapshot.status, "idle");
	assert.equal(sent.snapshot.canSend, true);
	assert.deepEqual(
		sent.snapshot.messages.map(({ role, text }) => ({ role, text })),
		[
			{ role: "user", text: "Hello" },
			{ role: "assistant", text: "Hello back" },
		],
	);
});

test("lost creation reuses its request ID", async () => {
	const f = fixture();
	let once = true;
	f.handle((input) => {
		if (input.op === "sessions.create" && once) {
			once = false;
			throw new Error("timeout");
		}
	});
	assert.equal((await f.service.send("Hello")).accepted, false);
	assert.equal((await f.service.send("Revised draft")).accepted, true);
	const creates = f.calls.filter((call) => call.op === "sessions.create");
	assert.deepEqual(creates[0], creates[1]);
});

test("uncertain delivery permits only an exact retry with the same identity", async () => {
	for (const fail of [
		() => {
			throw new Error("timeout after admission");
		},
		(input) => receipt({ status: "pending", command_id: input.requestId }),
		() => receipt({ status: "admitted", command_id: "wrong-request" }),
	]) {
		const f = fixture();
		f.handle((input) => {
			if (input.op === "sessions.message" && f.messages().length === 1)
				return fail(input);
		});
		const first = await f.service.send("Do this once");
		assert.equal(first.accepted, false);
		assert.equal(first.snapshot.sessionId, ID);
		const count = f.calls.length;
		assert.equal((await f.service.send("Different task")).accepted, false);
		assert.equal(f.calls.length, count);
		assert.equal((await f.service.send("Do this once")).accepted, true);
		assert.deepEqual(f.messages()[0], f.messages()[1]);
		assert.equal(
			f.calls.filter((call) => call.op === "sessions.create").length,
			1,
		);
	}
});

test("definite refusals allow edits with a new request ID", async () => {
	for (const status of [413, 422]) {
		const f = fixture();
		f.handle((input) => {
			if (input.op === "sessions.message" && f.messages().length === 1) {
				return receipt({}, status);
			}
		});
		assert.equal((await f.service.send("/unsupported")).accepted, false);
		assert.equal((await f.service.send("A plain prompt")).accepted, true);
		assert.notEqual(f.messages()[0].requestId, f.messages()[1].requestId);
	}
});

test("late creation cannot submit or unlock a newer send", async () => {
	const f = fixture();
	const oldCreate = Promise.withResolvers();
	const newCreate = Promise.withResolvers();
	f.handle((input) =>
		input.op === "sessions.create"
			? f.calls.length === 1
				? oldCreate.promise
				: newCreate.promise
			: undefined,
	);
	const first = f.service.send("Old task");
	assert.equal((await f.service.send("Duplicate task")).accepted, false);
	f.service.newChat();
	const second = f.service.send("New task");
	oldCreate.resolve(receipt({ session_id: ID }));
	assert.equal((await first).accepted, false);
	assert.equal((await f.service.send("Third task")).accepted, false);
	assert.equal(f.messages().length, 0);
	newCreate.resolve(receipt({ session_id: ID }));
	assert.equal((await second).accepted, true);
	assert.deepEqual(
		f.messages().map((call) => call.text),
		["New task"],
	);
});

test("fresh gates and silent owners stop an uncertain retry before delivery", async () => {
	for (const options of [
		{ pending_gate: { kind: "approval" } },
		{ pending_gate: { kind: "ask" } },
		{ cold_reason: "owner-silent" },
		{ cold_reason: "owner-leaving" },
	]) {
		const f = fixture();
		f.handle((input) => {
			if (input.op === "sessions.message") throw new Error("timeout");
		});
		await f.service.send("One task");
		f.setFrame(frame(options));
		assert.equal((await f.service.send("One task")).accepted, false);
		assert.equal(f.service.snapshot.canSend, false);
		assert.equal(f.messages().length, 1);
	}
});

test("transcript excludes reasoning, tools, attachments and partial updates", async () => {
	const f = fixture();
	f.setFrame(
		frame({
			history: [
				row("u", "user", "Hi"),
				row("a", "assistant", "", {
					content: [
						{ type: "thinking", text: "private reasoning" },
						{ text: "Visible reply" },
						{ type: "image", text: "image metadata" },
						{ attachment: "digest", text: "image caption metadata" },
						{ data: "abc", text: "base64 metadata" },
					],
				}),
				row("tool", "tool", "secret tool result"),
				row("custom", "assistant", "internal notice", { kind: "custom" }),
			],
			live_events: [
				{
					type: "message_update",
					delta: "partial fragment",
					message: { id: "partial", role: "assistant" },
				},
			],
		}),
	);
	await f.service.open(ID);
	assert.deepEqual(
		f.service.snapshot.messages.map((row) => row.text),
		["Hi", "Visible reply"],
	);
});

test("accepted work needs its own terminal turn, including after an owner change", async () => {
	for (const [epoch, echo, outcome, expected] of [
		["epoch", false, "aborted", "idle"],
		["replacement", true, "error", "error"],
		["replacement", false, "completed", "working"],
	]) {
		const f = fixture();
		f.handle((input) =>
			input.op === "sessions.message" ? admitted(input) : undefined,
		);
		const sent = await f.service.send("My exact task");
		assert.equal(sent.accepted, true);
		assert.equal(sent.snapshot.status, "working");
		f.setFrame(
			frame({
				epoch,
				generation: 1,
				last_turn_outcome: outcome,
				history: echo
					? [row(f.messages()[0].requestId, "user", "My exact task")]
					: [],
			}),
		);
		await f.service.refresh();
		assert.equal(f.service.snapshot.status, expected);
		assert.equal(f.service.snapshot.canSend, expected !== "working");
	}
});

test("read error outcomes remain visible and permit another prompt", async () => {
	const f = fixture();
	f.setFrame(
		frame({
			generation: 1,
			last_turn_outcome: "error",
			attention: { unseen: false, kind: "error" },
		}),
	);
	await f.service.open(ID);
	assert.equal(f.service.snapshot.status, "error");
	assert.equal(f.service.snapshot.canSend, true);
	assert.equal((await f.service.send("Try a smaller task")).accepted, true);
});

test("an old poll failure cannot replace newer chat state", async () => {
	const f = fixture();
	await f.service.open(ID);
	const pending = Promise.withResolvers();
	let once = true;
	f.handle((input) => {
		if (input.op === "sessions.get" && once) {
			once = false;
			return pending.promise;
		}
	});
	const oldPoll = f.service.refresh();
	const send = f.service.send("Hello");
	await new Promise((resolve) => setImmediate(resolve));
	pending.reject(new Error("old poll timed out"));
	await oldPoll;
	assert.equal((await send).accepted, true);
	await f.service.refresh();
	assert.equal(f.service.snapshot.status, "idle");
	assert.equal(f.service.snapshot.error, null);
});

test("session changes and disposal discard late reads", async () => {
	for (const dispose of [false, true]) {
		const f = fixture();
		const pending = Promise.withResolvers();
		f.handle((input) =>
			input.sessionId === ID ? pending.promise : frame({ sessionId: OTHER_ID }),
		);
		const first = f.service.open(ID);
		if (dispose) f.service.dispose();
		else await f.service.open(OTHER_ID);
		const count = f.changes.length;
		pending.resolve(frame({ conversation_title: "Wrong old title" }));
		await first;
		assert.equal(f.changes.length, count);
		if (!dispose) assert.equal(f.service.snapshot.sessionId, OTHER_ID);
	}
});

test("invalid drafts stay local and snapshots cannot mutate state", async () => {
	const f = fixture();
	for (const text of ["", "   ", "x".repeat(16_001)])
		assert.equal((await f.service.send(text)).accepted, false);
	assert.equal(f.calls.length, 0);
	const snapshot = f.service.snapshot;
	snapshot.messages.push({ id: "fake", role: "assistant", text: "injected" });
	assert.deepEqual(f.service.snapshot.messages, []);
});
