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

test("only the latest reply is shown; reading position survives rerenders and collapse", async () => {
	await fixture(async ({ host, render }) => {
		const first = { id: "a", role: "assistant", text: "An earlier answer" };
		await render({ snapshot: { ...idle, messages: [first] } });
		const viewport = host.querySelector(".companion-chat-reply");
		// jsdom has no layout; this verifies scroll ownership, not native geometry.
		viewport.scrollTop = 70;
		await render({
			snapshot: {
				...idle,
				messages: [{ ...first, text: "The same answer updated" }],
			},
		});
		assert.equal(viewport.scrollTop, 70);
		await render({ open: false });
		await render({ open: true });
		assert.equal(viewport.scrollTop, 70);
		await render({
			snapshot: {
				...idle,
				messages: [
					first,
					{ id: "u", role: "user", text: "Do not show my earlier question" },
					{ id: "b", role: "assistant", text: "The latest reply" },
				],
			},
		});
		assert.equal(viewport.scrollTop, 0);
		assert.equal(viewport.textContent, "The latest reply");
		assert.equal(host.textContent.includes(first.text), false);
		assert.equal(
			host.textContent.includes("Do not show my earlier question"),
			false,
		);
		assert.equal(viewport.tabIndex, 0);
	});
});

test("working disables replacement; attention is one neutral handoff; text stays plain", async () => {
	let expansions = 0;
	await fixture(
		async ({ host, render, input, type }) => {
			await render({ snapshot: { ...idle, sessionId: null } });
			assert.equal(
				host.querySelector('[aria-label="Open chat in the full app"]'),
				null,
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
				"Needs your input",
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

test("a new draft starts with one row and only Send and Collapse controls", async () => {
	await fixture(
		async ({ host, input }) => {
			assert.equal(input().rows, 1);
			assert.equal(
				host.querySelector("header, h1, h2, .companion-chat-reply"),
				null,
			);
			assert.deepEqual(
				Array.from(host.querySelectorAll("button"), (button) =>
					button.getAttribute("aria-label"),
				),
				["Send message", "Collapse chat"],
			);
			assert.equal(
				host.textContent.includes("default Local Operator model"),
				false,
			);
			assert.equal(host.querySelector(".companion-chat-status"), null);
			assert.equal(host.querySelector(".companion-chat-count"), null);
		},
		{ snapshot: { ...idle, sessionId: null } },
	);
});

test("Escape collapses the bubble but does not interrupt IME composition", async () => {
	let collapsed = 0;
	await fixture(
		async ({ key }) => {
			await act(async () => key({ key: "Escape", isComposing: true }));
			assert.equal(collapsed, 0);
			await act(async () => key({ key: "Escape" }));
			assert.equal(collapsed, 1);
		},
		{
			onCollapse: () => {
				collapsed++;
			},
		},
	);
});

test("an uncertain send retains the original text even if a synthetic input arrives while read-only", async () => {
	let finish;
	await fixture(
		async ({ input, type, submit }) => {
			await type("The exact original message");
			await act(async () => submit());
			assert.equal(input().readOnly, true);
			await type("An input event during admission");
			await act(async () => finish(false));
			assert.equal(input().value, "The exact original message");
			assert.equal(input().readOnly, false);
		},
		{
			onSend: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	);
});
