import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const frames = new Map();
let frameId = 0;
globalThis.requestAnimationFrame = (callback) => {
	frames.set(++frameId, callback);
	return frameId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const { createRoot } = await import("react-dom/client");
const bundle = await build({
	entryPoints: ["src/renderer/src/companion-interaction.ts"],
	bundle: true,
	packages: "external",
	platform: "node",
	format: "esm",
	write: false,
});
const path = new URL(
	`./_companion-interaction-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(path, bundle.outputFiles[0].text);
const { useCompanionInteraction } = await import(path.href);
await unlink(path);
after(() => {
	dom.window.close();
	for (const key of [
		"window",
		"document",
		"HTMLElement",
		"IS_REACT_ACT_ENVIRONMENT",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	])
		delete globalThis[key];
});

async function fixture(callback) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	function Probe() {
		const interaction = useCompanionInteraction();
		return React.createElement("button", {
			type: "button",
			...interaction.handlers,
			"data-reaction": interaction.reaction,
			"data-gaze": JSON.stringify(interaction.gaze),
		});
	}
	await act(async () => root.render(React.createElement(Probe)));
	const button = host.querySelector("button");
	button.getBoundingClientRect = () => ({
		left: 10,
		top: 20,
		width: 100,
		height: 100,
	});
	const event = async (type, options = {}) => {
		await act(async () => {
			const value = new dom.window.MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				clientX: 60,
				clientY: 70,
				screenX: 100,
				screenY: 100,
				...options,
			});
			Object.defineProperty(value, "pointerType", {
				value: options.pointerType ?? "mouse",
			});
			Object.defineProperty(value, "isPrimary", {
				value: options.isPrimary ?? true,
			});
			button.dispatchEvent(value);
		});
	};
	const flush = async () =>
		act(async () => {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(0);
		});
	try {
		await callback({
			button,
			event,
			flush,
			gaze: () => JSON.parse(button.dataset.gaze),
		});
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

test("hover tracks bounded gaze once per frame and leaving returns to rest", async () => {
	await fixture(async ({ button, event, flush, gaze }) => {
		await event("pointerover", { clientX: 20, clientY: 30 });
		assert.equal(button.dataset.reaction, "curious");
		await event("pointermove", { clientX: 90, clientY: 50 });
		await event("pointermove", { clientX: 500, clientY: -500 });
		assert.equal(frames.size, 1);
		await flush();
		assert.deepEqual(gaze(), { x: 1, y: -1 });
		await event("pointerout");
		assert.equal(button.dataset.reaction, "rest");
		assert.deepEqual(gaze(), { x: 0, y: 0 });
	});
});

test("press and drag reactions clear on release, cancellation and window blur", async () => {
	await fixture(async ({ button, event, flush }) => {
		await event("pointerover");
		await event("pointerdown");
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointermove", { screenX: 102 });
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointermove", { screenX: 110 });
		assert.equal(button.dataset.reaction, "dragging");
		await event("pointerup");
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerdown");
		await event("pointercancel");
		assert.equal(button.dataset.reaction, "rest");
		await event("pointerdown");
		await act(async () => window.dispatchEvent(new dom.window.Event("blur")));
		await flush();
		assert.equal(button.dataset.reaction, "rest");
	});
});

test("secondary, control-click and non-primary pointers never trigger press", async () => {
	await fixture(async ({ button, event }) => {
		for (const options of [
			{ button: 2 },
			{ button: 0, ctrlKey: true },
			{ button: 0, isPrimary: false },
		]) {
			await event("pointerdown", options);
			assert.equal(button.dataset.reaction, "rest");
		}
		await event("pointerover", { pointerType: "touch" });
		assert.equal(button.dataset.reaction, "rest");
		assert.equal(frames.size, 0);
	});
});

test("keyboard engagement survives pointer leave; unmount cancels queued tracking", async () => {
	await fixture(async ({ button, event }) => {
		await act(async () => button.focus());
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerover");
		await event("pointerout");
		assert.equal(button.dataset.reaction, "curious");
		await act(async () => button.blur());
		assert.equal(button.dataset.reaction, "rest");
		await event("pointermove");
		assert.equal(frames.size, 1);
	});
	assert.equal(frames.size, 0);
});
