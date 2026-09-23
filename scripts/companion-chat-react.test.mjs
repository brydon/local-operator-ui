import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.HTMLElement = undefined;
	globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const bundle = await build({
	entryPoints: ["src/renderer/src/companion-chat.tsx"],
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_companion-chat-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CompanionChat } = await import(bundlePath.href);
await unlink(bundlePath);

const idle = {
	sessionId: "session-one",
	title: "Local Operator",
	messages: [],
	status: "idle",
	error: null,
	canSend: true,
};

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function mount(t, overrides = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	t.after(async () => {
		await act(() => root.unmount());
		host.remove();
	});
	let props = {
		snapshot: idle,
		open: true,
		onSend: async () => true,
		onNewChat: () => {},
		onCollapse: () => {},
		onExpand: () => {},
		...overrides,
	};
	const render = async (next = {}) => {
		props = { ...props, ...next };
		await act(() => root.render(React.createElement(CompanionChat, props)));
	};
	await render();
	const input = host.querySelector("textarea");
	const button = (label) => host.querySelector(`[aria-label="${label}"]`);
	const type = (value) =>
		act(() => {
			Object.getOwnPropertyDescriptor(
				dom.window.HTMLTextAreaElement.prototype,
				"value",
			).set.call(input, value);
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
	const submit = () =>
		host
			.querySelector("form")
			.dispatchEvent(
				new dom.window.Event("submit", { bubbles: true, cancelable: true }),
			);
	const key = (options = {}) =>
		act(() =>
			input.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
					...options,
				}),
			),
		);
	return { host, render, input, button, type, submit, key };
}

test("collapse preserves drafts and pending sends cannot be duplicated", async (t) => {
	const pending = deferred();
	const sent = [];
	const { host, render, input, button, type, submit } = await mount(t, {
		onSend: (text) => {
			sent.push(text);
			return pending.promise;
		},
	});
	assert.equal(document.activeElement, input);
	await type("  Help me plan this  ");
	await render({ open: false });
	assert.equal(host.querySelector("section").hidden, true);
	await render({ open: true });
	assert.equal(input.value, "  Help me plan this  ");
	await act(() => {
		submit();
		submit();
	});
	assert.deepEqual(sent, ["Help me plan this"]);
	assert.equal(input.readOnly, true);
	assert.equal(button("New chat").disabled, true);
	assert.equal(button("Send message").disabled, true);
	await act(() => pending.resolve(true));
	await render({ snapshot: { ...idle, status: "working", canSend: false } });
	assert.equal(input.value, "");
	assert.equal(input.readOnly, false);
	await type("My next thought");
	assert.equal(input.value, "My next thought");
});

for (const moveFocus of [false, true]) {
	test(`send completion ${moveFocus ? "preserves another control's focus" : "returns focus to the input"}`, async (t) => {
		const pending = deferred();
		const { input, button, type, submit } = await mount(t, {
			onSend: () => pending.promise,
		});
		await type("One message");
		button("Send message").focus();
		await act(() => submit());
		const expand = button("Open chat in the full app");
		if (moveFocus) expand.focus();
		await act(() => pending.resolve(true));
		assert.equal(document.activeElement, moveFocus ? expand : input);
	});
}

test("failed delivery retains the draft and displays the service error", async (t) => {
	const { host, render, input, button, type, submit } = await mount(t, {
		onSend: async () => {
			throw new Error("Disconnected");
		},
	});
	await type("Keep this safe");
	await act(() => submit());
	assert.equal(input.value, "Keep this safe");
	assert.ok(
		host
			.querySelector('[role="alert"]')
			.textContent.includes("could not be confirmed"),
	);
	await render({
		snapshot: {
			...idle,
			status: "error",
			error: "Check chat before trying again.",
			canSend: false,
		},
	});
	assert.equal(
		host.querySelector('[role="alert"]').textContent,
		"Check chat before trying again.",
	);
	assert.equal(button("Send message").disabled, true);
});

test("Enter sends, Shift+Enter adds a line, and IME ignores Enter and Escape", async (t) => {
	const sent = [];
	let collapsed = 0;
	const { input, type, key } = await mount(t, {
		onSend: async (text) => {
			sent.push(text);
			return true;
		},
		onCollapse: () => collapsed++,
	});
	await type("こんにちは");
	await key({ isComposing: true });
	await key({ keyCode: 229 });
	await key({ shiftKey: true });
	await key({ key: "Escape", isComposing: true });
	assert.deepEqual(sent, []);
	assert.equal(collapsed, 0);
	await key();
	assert.deepEqual(sent, ["こんにちは"]);
	assert.equal(input.value, "");
	await key({ key: "Escape" });
	assert.equal(collapsed, 1);
});

test("reply updates preserve scroll position until the next answer", async (t) => {
	const { host, render } = await mount(t);
	const first = { id: "a", role: "assistant", text: "First answer" };
	await render({ snapshot: { ...idle, messages: [first] } });
	const reply = () => host.querySelector(".companion-chat-reply");
	reply().scrollTop = 70;
	await render({
		snapshot: { ...idle, messages: [{ ...first, text: "Updated answer" }] },
	});
	await render({ open: false });
	await render({ open: true });
	assert.equal(reply().scrollTop, 70);
	reply().focus();
	await render({
		snapshot: {
			...idle,
			messages: [first, { id: "b", role: "assistant", text: "Next answer" }],
		},
	});
	assert.equal(reply().textContent, "Next answer");
	assert.equal(reply().scrollTop, 0);
	assert.equal(document.activeElement, reply());
});

test("pending approval blocks sending and opens the full app", async (t) => {
	let expanded = false;
	const { host, render, input, button, type } = await mount(t, {
		onExpand: () => {
			expanded = true;
		},
	});
	await render({ snapshot: { ...idle, status: "working", canSend: false } });
	await type("A follow-up");
	assert.equal(button("New chat").disabled, true);
	await render({
		snapshot: {
			...idle,
			status: "attention",
			error: "Approval required",
			canSend: false,
		},
	});
	assert.equal(button("Send message").disabled, true);
	assert.equal(host.querySelector('[role="alert"]'), null);
	await act(() => host.querySelector(".companion-chat-open").click());
	assert.equal(expanded, true);
	assert.equal(input.value, "A follow-up");
});
