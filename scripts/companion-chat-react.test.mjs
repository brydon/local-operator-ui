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

async function fixture(callback, overrides = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
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
		await act(async () =>
			root.render(React.createElement(CompanionChat, props)),
		);
	};
	const input = () => host.querySelector("textarea");
	const type = async (value) => {
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				dom.window.HTMLTextAreaElement.prototype,
				"value",
			).set.call(input(), value);
			input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
	};
	const submit = () =>
		host
			.querySelector("form")
			.dispatchEvent(
				new dom.window.Event("submit", { bubbles: true, cancelable: true }),
			);
	const key = (options = {}) => {
		const event = new dom.window.KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
			...options,
		});
		input().dispatchEvent(event);
		return event;
	};
	try {
		await render();
		await callback({ host, render, input, type, submit, key });
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

test("draft survives collapse and delivery; repeated submission sends once", async () => {
	let finish;
	const sent = [];
	await fixture(
		async ({ host, render, input, type, submit }) => {
			assert.equal(document.activeElement, input());
			await act(async () => {
				const newChat = host.querySelector('[aria-label="New chat"]');
				newChat.focus();
				newChat.click();
			});
			assert.equal(document.activeElement, input());
			await type("  Help me plan this  ");
			await render({ open: false });
			assert.equal(host.querySelector("section").hidden, true);
			await render({ open: true });
			assert.equal(input().value, "  Help me plan this  ");
			await act(async () => {
				submit();
				submit();
			});
			assert.deepEqual(sent, ["Help me plan this"]);
			assert.equal(input().value, "  Help me plan this  ");
			assert.equal(
				host.querySelector('[aria-label="New chat"]').disabled,
				true,
			);
			assert.equal(
				host.querySelector('[aria-label="Send message"]').disabled,
				true,
			);
			await act(async () => finish(true));
			assert.equal(input().value, "");
		},
		{
			onSend: (text) => {
				sent.push(text);
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		},
	);
});

test("pending delivery keeps a selectable read-only draft; accepted work allows the next draft", async () => {
	let finish;
	await fixture(
		async ({ render, input, type, submit }) => {
			await type("First message");
			await act(async () => submit());
			assert.equal(input().readOnly, true);
			input().select();
			assert.equal(input().selectionStart, 0);
			assert.equal(input().selectionEnd, "First message".length);
			assert.equal(input().value, "First message");
			await act(async () => finish(true));
			await render({
				snapshot: { ...idle, status: "working", canSend: false },
			});
			assert.equal(input().readOnly, false);
			assert.equal(input().value, "");
			await type("My next thought");
			assert.equal(input().value, "My next thought");
		},
		{
			onSend: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	);
});

test("delivery returns focus only while the Send button still owns it", async () => {
	for (const moveFocus of [false, true]) {
		let finish;
		await fixture(
			async ({ host, input, type, submit }) => {
				await type("One message");
				const send = host.querySelector('[aria-label="Send message"]');
				const expand = host.querySelector(
					'[aria-label="Open chat in the full app"]',
				);
				send.focus();
				await act(async () => submit());
				if (moveFocus) expand.focus();
				await act(async () => finish(true));
				assert.equal(document.activeElement, moveFocus ? expand : input());
			},
			{
				onSend: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			},
		);
	}
});

test("unconfirmed delivery keeps the draft and defers to the service error", async () => {
	await fixture(
		async ({ host, render, input, type, submit }) => {
			await type("Keep this safe");
			await act(async () => submit());
			assert.equal(input().value, "Keep this safe");
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
			assert.equal(
				host.querySelector('[aria-label="Send message"]').disabled,
				true,
			);
		},
		{
			onSend: async () => {
				throw new Error("Transport unavailable");
			},
		},
	);
});

test("IME and Shift+Enter do not submit; regular Enter does", async () => {
	const sent = [];
	await fixture(
		async ({ input, type, key }) => {
			await type("こんにちは");
			await act(async () => {
				assert.equal(key({ isComposing: true }).defaultPrevented, false);
				assert.equal(key({ keyCode: 229 }).defaultPrevented, false);
				assert.equal(key({ shiftKey: true }).defaultPrevented, false);
			});
			assert.deepEqual(sent, []);
			await act(async () => {
				assert.equal(key().defaultPrevented, true);
			});
			assert.deepEqual(sent, ["こんにちは"]);
			assert.equal(input().value, "");
		},
		{
			onSend: async (text) => {
				sent.push(text);
				return true;
			},
		},
	);
});

test("new messages preserve reading position until the reader returns to the bottom", async () => {
	await fixture(async ({ host, render }) => {
		const viewport = host.querySelector(".companion-chat-transcript");
		let height = 500;
		// jsdom does not lay out text. These are explicit scroll inputs, not
		// evidence about browser geometry or screenshot appearance.
		Object.defineProperty(viewport, "scrollHeight", { get: () => height });
		Object.defineProperty(viewport, "clientHeight", { value: 100 });
		viewport.scrollTop = 100;
		viewport.dispatchEvent(new dom.window.Event("scroll"));
		height = 600;
		await render({
			snapshot: {
				...idle,
				messages: [{ id: "a", role: "assistant", text: "A new answer" }],
			},
		});
		assert.equal(viewport.scrollTop, 100);
		viewport.scrollTop = 500;
		viewport.dispatchEvent(new dom.window.Event("scroll"));
		height = 700;
		await render({
			snapshot: {
				...idle,
				messages: [{ id: "a", role: "assistant", text: "A longer answer" }],
			},
		});
		assert.equal(viewport.scrollTop, height);
	});
});

test("working disables replacement; attention is one neutral handoff; text stays plain", async () => {
	let expansions = 0;
	await fixture(
		async ({ host, render, input, type }) => {
			await render({ snapshot: { ...idle, sessionId: null } });
			assert.equal(
				host.querySelector('[aria-label="Open chat in the full app"]').disabled,
				true,
			);
			await render({
				snapshot: { ...idle, status: "working", canSend: false },
			});
			await type("A follow-up");
			assert.equal(
				host.querySelector('[aria-label="New chat"]').disabled,
				true,
			);
			assert.equal(
				host.querySelector('[aria-label="Send message"]').disabled,
				true,
			);
			await render({
				snapshot: {
					...idle,
					status: "attention",
					error: "Approval required",
					canSend: false,
					messages: [
						{
							id: "a",
							role: "assistant",
							text: "<script>not executable</script>",
						},
					],
				},
			});
			assert.equal(host.querySelector('[role="alert"]'), null);
			assert.equal(host.querySelector("script"), null);
			assert.ok(host.textContent.includes("<script>not executable</script>"));
			assert.equal(
				host.querySelector("output").textContent,
				"Needs your input in the full app.",
			);
			await act(async () => host.querySelector(".companion-chat-open").click());
			assert.equal(expansions, 1);
			assert.equal(input().maxLength, 16000);
			assert.equal(input().value, "A follow-up");
		},
		{
			onExpand: () => {
				expansions += 1;
			},
		},
	);
});
