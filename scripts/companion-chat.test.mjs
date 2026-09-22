import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/companion-chat";',
		resolveDir: process.cwd(),
	},
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
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const receipt = (result, status = 200) => ({
	status,
	body: { status, result },
});
const row = (id, role, text, extra = {}) => ({
	id,
	type: "message",
	payload: { role, content: [{ text }], ...extra },
});
const frame = ({
	sessionId = ID,
	history = [],
	streaming = false,
	pending_gate = null,
	live_events = [],
	cold_reason = null,
	generation = 0,
	last_turn_outcome = "",
	...state
} = {}) =>
	receipt({
		session_id: sessionId,
		type: "snapshot",
		epoch: "epoch",
		seq: generation,
		payload: {
			cold_reason,
			history: { entries: history, has_more: false, cursor_missing: false },
			frontend: {
				snapshot: {
					session_id: sessionId,
					epoch: "epoch",
					conversation_title: "A small chat",
					streaming,
					pending_gate,
					live_events,
					generation,
					last_turn_outcome,
					...state,
				},
			},
		},
	});

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

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
				return receipt({
					status: "admitted",
					command_id: input.requestId,
					duplicate: false,
				});
			}
			throw new Error(`Unexpected operation ${input.op}`);
		},
	});
	return {
		service,
		calls,
		changes,
		setFrame: (value) => {
			current = value;
		},
		handle: (value) => {
			override = value;
		},
	};
}

test("opening a new pane does not create or query a conversation", async () => {
	const f = fixture();
	await f.service.open();
	await f.service.refresh();
	assert.equal(f.calls.length, 0);
	assert.equal(f.service.snapshot.sessionId, null);
	assert.equal(f.service.snapshot.canSend, true);
});

test("send creates lazily with default model/agent, waits for admission, and reads authoritative prose", async () => {
	const f = fixture();
	const sent = await f.service.send("Hello");
	assert.equal(sent.accepted, true);
	assert.deepEqual(
		f.calls.map((call) => call.op),
		["sessions.create", "sessions.get", "sessions.message", "sessions.get"],
	);
	assert.deepEqual(Object.keys(f.calls[0]).sort(), ["cwd", "op", "requestId"]);
	assert.equal(f.calls[0].cwd, "/a/known/directory");
	assert.match(f.calls[0].requestId, UUID);
	assert.equal(f.calls[2].mode, "prompt");
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

test("a lost create response reuses the original receipt identity", async () => {
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

test("an uncertain send keeps session, text and UUID for an explicit safe retry", async () => {
	const f = fixture();
	let once = true;
	f.handle((input) => {
		if (input.op === "sessions.message" && once) {
			once = false;
			throw new Error("timeout after admission");
		}
	});
	const first = await f.service.send("Do this once");
	assert.equal(first.accepted, false);
	assert.equal(first.snapshot.sessionId, ID);
	const count = f.calls.length;
	assert.equal((await f.service.send("Different task")).accepted, false);
	assert.equal(f.calls.length, count);
	assert.equal((await f.service.send("Do this once")).accepted, true);
	const messages = f.calls.filter((call) => call.op === "sessions.message");
	assert.deepEqual(messages[0], messages[1]);
	assert.equal(
		f.calls.filter((call) => call.op === "sessions.create").length,
		1,
	);
});

test("413 and 422 refusals allow an edited message with a fresh UUID", async () => {
	for (const status of [413, 422]) {
		const f = fixture();
		let once = true;
		f.handle((input) => {
			if (input.op === "sessions.message" && once) {
				once = false;
				return receipt({}, status);
			}
		});
		assert.equal((await f.service.send("/unsupported")).accepted, false);
		assert.equal((await f.service.send("A plain prompt")).accepted, true);
		const calls = f.calls.filter((call) => call.op === "sessions.message");
		assert.notEqual(calls[0].requestId, calls[1].requestId);
	}
});

test("a success HTTP code without a matching admitted receipt remains uncertain", async () => {
	const f = fixture();
	f.handle((input) =>
		input.op === "sessions.message"
			? receipt({ status: "pending", command_id: input.requestId })
			: undefined,
	);
	const sent = await f.service.send("Hello");
	assert.equal(sent.accepted, false);
	assert.equal(sent.snapshot.status, "error");
	assert.equal(sent.snapshot.canSend, true);
});

test("double send is serialized and navigating away prevents a late create from submitting", async () => {
	const f = fixture();
	const pending = deferred();
	f.handle((input) =>
		input.op === "sessions.create" ? pending.promise : undefined,
	);
	const first = f.service.send("One task");
	assert.equal((await f.service.send("One task")).accepted, false);
	assert.equal(f.calls.length, 1);
	f.service.newChat();
	pending.resolve(receipt({ session_id: ID }));
	assert.equal((await first).accepted, false);
	assert.equal(f.service.snapshot.sessionId, null);
	assert.equal(
		f.calls.some((call) => call.op === "sessions.message"),
		false,
	);
});

test("pending gates and silent owners are handoffs, including during uncertain retries", async () => {
	for (const options of [
		{ pending_gate: { kind: "approval" } },
		{ pending_gate: { kind: "ask" } },
		{ cold_reason: "owner-silent" },
		{ cold_reason: "owner-leaving" },
	]) {
		const f = fixture();
		f.setFrame(frame(options));
		await f.service.open(ID);
		assert.equal(f.service.snapshot.canSend, false);
		assert.equal((await f.service.send("yes")).accepted, false);
		assert.deepEqual(
			f.calls.map((call) => call.op),
			["sessions.get"],
		);
	}
});

test("transcript projection excludes hidden reasoning, tool payloads, image metadata and partial deltas", async () => {
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

test("accepted work stays busy until a terminal turn, including empty fast turns", async () => {
	const f = fixture();
	f.handle((input) =>
		input.op === "sessions.message"
			? receipt({ status: "admitted", command_id: input.requestId })
			: undefined,
	);
	const sent = await f.service.send("Do work");
	assert.equal(sent.accepted, true);
	assert.equal(sent.snapshot.status, "working");
	assert.equal(sent.snapshot.canSend, false);
	f.setFrame(frame({ generation: 1, last_turn_outcome: "aborted" }));
	await f.service.refresh();
	assert.equal(f.service.snapshot.status, "idle");
	assert.equal(f.service.snapshot.canSend, true);
});

test("an error outcome remains visible after its attention watermark was read and allows a new prompt", async () => {
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

test("a fast empty turn settles after a cold session starts a new runtime epoch", async () => {
	const f = fixture();
	f.setFrame(frame({ epoch: `cold-${ID}` }));
	f.handle((input) => {
		if (input.op !== "sessions.message") return;
		f.setFrame(
			frame({
				history: [row(input.requestId, "user", input.text)],
				generation: 1,
				last_turn_outcome: "error",
				attention: { kind: "error", unseen: false },
			}),
		);
		return receipt({ status: "admitted", command_id: input.requestId });
	});
	const sent = await f.service.send(
		"A task that fails without assistant prose",
	);
	assert.equal(sent.accepted, true);
	assert.equal(sent.snapshot.status, "error");
	assert.equal(sent.snapshot.canSend, true);
});

test("an unrelated replacement owner cannot claim an unobserved send finished", async () => {
	const f = fixture();
	f.setFrame(frame({ epoch: `cold-${ID}` }));
	f.handle((input) => {
		if (input.op !== "sessions.message") return;
		f.setFrame(frame({ generation: 1, last_turn_outcome: "completed" }));
		return receipt({ status: "admitted", command_id: input.requestId });
	});
	const sent = await f.service.send("My exact task");
	assert.equal(sent.accepted, true);
	assert.equal(sent.snapshot.status, "working");
	assert.equal(sent.snapshot.canSend, false);
});

test("a rejected old poll cannot overwrite a newer successful send", async () => {
	const f = fixture();
	await f.service.open(ID);
	const pending = deferred();
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

test("opening another session or disposing invalidates late successful reads", async () => {
	const f = fixture();
	const pending = deferred();
	f.handle((input) =>
		input.sessionId === ID ? pending.promise : frame({ sessionId: OTHER_ID }),
	);
	const first = f.service.open(ID);
	await f.service.open(OTHER_ID);
	pending.resolve(frame({ conversation_title: "Wrong old title" }));
	await first;
	assert.equal(f.service.snapshot.sessionId, OTHER_ID);
	assert.equal(f.service.snapshot.title, "A small chat");
	const count = f.changes.length;
	f.service.dispose();
	await f.service.open(ID);
	await f.service.send("No longer active");
	assert.equal(f.changes.length, count);
});

test("invalid input is refused locally and returned snapshots cannot mutate service state", async () => {
	const f = fixture();
	for (const text of ["", "   ", "x".repeat(16_001)])
		assert.equal((await f.service.send(text)).accepted, false);
	assert.equal(f.calls.length, 0);
	const snapshot = f.service.snapshot;
	snapshot.messages.push({ id: "fake", role: "assistant", text: "injected" });
	assert.deepEqual(f.service.snapshot.messages, []);
});
