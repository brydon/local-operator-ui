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
const motion = new dom.window.EventTarget();
motion.matches = false;
window.matchMedia = () => motion;
const timers = new Map();
let now = 0;
let timerId = 0;
window.performance.now = () => now;
window.setTimeout = (callback, delay) => {
	timers.set(++timerId, { callback, due: now + delay });
	return timerId;
};
window.clearTimeout = (id) => timers.delete(id);
const advance = async (ms) =>
	act(async () => {
		const end = now + ms;
		while (true) {
			const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
			if (!next || next[1].due > end) break;
			now = next[1].due;
			timers.delete(next[0]);
			next[1].callback();
		}
		now = end;
	});
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
	const getHours = Date.prototype.getHours;
	let hour = 12;
	Date.prototype.getHours = () => hour;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let mood = "idle";
	let chatOpen = false;
	let released;
	function Probe() {
		const interaction = useCompanionInteraction(mood, chatOpen);
		return React.createElement("button", {
			type: "button",
			...interaction.handlers,
			onClick: (event) => {
				if (event.detail === 0) interaction.tap();
			},
			onPointerUp: (event) => {
				released = interaction.handlers.onPointerUp(event);
			},
			"data-engaged": interaction.isEngaged,
			"data-reaction": interaction.reaction,
			"data-gaze": JSON.stringify(interaction.gaze),
		});
	}
	await act(async () => root.render(React.createElement(Probe)));
	const button = host.querySelector("button");
	let captured = false;
	button.setPointerCapture = () => {
		captured = true;
	};
	button.hasPointerCapture = () => captured;
	button.releasePointerCapture = () => {
		captured = false;
	};
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
			Object.defineProperty(value, "timeStamp", { value: now });
			Object.defineProperty(value, "pointerType", {
				value: options.pointerType ?? "mouse",
			});
			Object.defineProperty(value, "pointerId", {
				value: options.pointerId ?? 1,
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
			advance,
			hour: (value) => {
				hour = value;
			},
			reduceMotion: async (matches) =>
				act(async () => {
					motion.matches = matches;
					motion.dispatchEvent(new dom.window.Event("change"));
				}),
			released: () => released,
			mood: async (next) => {
				mood = next;
				await act(async () => root.render(React.createElement(Probe)));
			},
			chat: async (open) => {
				chatOpen = open;
				await act(async () => root.render(React.createElement(Probe)));
			},
			visibility: async (hidden) =>
				act(async () => {
					Object.defineProperty(document, "hidden", {
						configurable: true,
						value: hidden,
					});
					document.dispatchEvent(new dom.window.Event("visibilitychange"));
				}),
			gaze: () => JSON.parse(button.dataset.gaze),
		});
	} finally {
		await act(async () => root.unmount());
		assert.equal(button.hasPointerCapture(1), false);
		Date.prototype.getHours = getHours;
		motion.matches = false;
		Reflect.deleteProperty(document, "hidden");
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

test("a tap is happy, a six-pixel move stays a tap, and dragging lands without a click", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await event("pointerover");
		await event("pointerdown");
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointermove", { screenX: 106 });
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointerup");
		assert.equal(released(), "tap");
		assert.equal(button.dataset.reaction, "happy");
		await event("pointermove");
		assert.equal(button.dataset.reaction, "happy");
		for (let i = 0; i < 6; i++) {
			await event("pointerdown");
			await event("pointerup");
			assert.equal(timers.size, 2);
		}
		await advance(1200);
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerdown");
		await event("pointermove", { screenX: 107 });
		assert.equal(button.dataset.reaction, "grabbed");
		await event("pointermove", { screenX: 100 });
		await event("pointerup");
		assert.equal(released(), "drag");
		assert.equal(button.dataset.reaction, "landing");
		await event("lostpointercapture");
		assert.equal(button.dataset.reaction, "landing");
		await event("pointerup");
		assert.equal(released(), null);
		await advance(900);
		assert.equal(button.dataset.reaction, "curious");
	});
});

test("three rapid taps show love with a shared cooldown and no extra timers", async () => {
	await fixture(async ({ button, event, advance }) => {
		const tap = async () => {
			await event("pointerdown");
			await event("pointerup");
		};
		await tap();
		assert.equal(button.dataset.reaction, "happy");
		await advance(200);
		await tap();
		await advance(200);
		await tap();
		assert.equal(button.dataset.reaction, "loved");
		for (let i = 0; i < 3; i++) await tap();
		assert.equal(button.dataset.reaction, "happy");
		assert.equal(timers.size, 2);
		await advance(2000);
		for (let i = 0; i < 3; i++) await tap();
		assert.equal(button.dataset.reaction, "loved");
		for (let i = 0; i < 3; i++) {
			await advance(1100);
			await tap();
			assert.equal(button.dataset.reaction, "happy");
		}
	});
});

test("chat keeps the companion awake; waking yields immediately to a new grab", async () => {
	await fixture(async ({ button, event, advance, chat }) => {
		await advance(90_000);
		assert.equal(button.dataset.reaction, "dozing");
		await chat(true);
		assert.equal(button.dataset.reaction, "waking");
		await advance(100_000);
		assert.equal(button.dataset.reaction, "rest");
		assert.equal(timers.size, 0);
		await chat(false);
		await advance(90_000);
		await event("pointerover");
		assert.equal(button.dataset.reaction, "waking");
		await event("pointerdown");
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointermove", { screenX: 120 });
		assert.equal(button.dataset.reaction, "grabbed");
		await advance(800);
		assert.equal(button.dataset.reaction, "dragging");
	});
});

test("idle scenes rotate before the time-of-day gesture and keep the sleep deadline", async () => {
	for (const [time, reaction] of [
		[5, "stretching"],
		[10, "stretching"],
		[11, "daydream"],
		[20, "daydream"],
		[21, "yawning"],
		[4, "yawning"],
	]) {
		await fixture(async ({ button, advance, hour }) => {
			hour(time);
			await advance(13_999);
			assert.equal(button.dataset.reaction, "rest");
			await advance(1);
			assert.equal(button.dataset.reaction, "peekaboo");
			await advance(4800);
			assert.equal(button.dataset.reaction, "rest");
			await advance(17_200);
			assert.equal(button.dataset.reaction, "playful");
			await advance(4000);
			assert.equal(button.dataset.reaction, "rest");
			await advance(19_000);
			assert.equal(button.dataset.reaction, reaction);
			assert.equal(timers.size, 2);
			await advance(2600);
			assert.equal(button.dataset.reaction, "rest");
			assert.equal(timers.size, 1);
			await advance(18_400);
			assert.equal(button.dataset.reaction, "daydream");
			await advance(9_999);
			assert.equal(button.dataset.reaction, "rest");
			await advance(1);
			assert.equal(button.dataset.reaction, "dozing");
			assert.equal(timers.size, 0);
		});
	}
	await fixture(async ({ button, advance }) => {
		const [id, timer] = timers.entries().next().value;
		await act(async () => {
			timers.delete(id);
			now += 89_000;
			timer.callback();
		});
		assert.equal(button.dataset.reaction, "rest");
		await advance(1000);
		assert.equal(button.dataset.reaction, "dozing");
	});
});

test("ambient gestures yield to attention, task changes, chat, hiding and reduced motion", async () => {
	for (const interrupt of [
		(f) => f.event("pointerover"),
		(f) => f.event("pointermove"),
		(f) => f.event("pointerdown"),
		(f) => act(async () => f.button.focus()),
		(f) => f.mood("working"),
		(f) => f.chat(true),
		(f) => f.visibility(true),
		(f) => f.reduceMotion(true),
	]) {
		await fixture(async (f) => {
			await f.advance(14_000);
			assert.equal(f.button.dataset.reaction, "peekaboo");
			await interrupt(f);
			assert.notEqual(f.button.dataset.reaction, "peekaboo");
			await f.advance(4800);
			assert.notEqual(f.button.dataset.reaction, "peekaboo");
		});
	}
	for (const engage of [
		(f) => f.event("pointerover"),
		(f) => act(async () => f.button.focus()),
		(f) => f.event("pointerdown"),
		(f) => f.reduceMotion(true),
	]) {
		await fixture(async (f) => {
			await engage(f);
			await f.advance(14_000);
			assert.notEqual(f.button.dataset.reaction, "peekaboo");
		});
	}
	assert.equal(timers.size, 0);
});

test("interrupting an idle scene advances to a different game next time", async () => {
	await fixture(async ({ button, advance, event }) => {
		await advance(14_000);
		assert.equal(button.dataset.reaction, "peekaboo");
		await event("pointerover");
		await event("pointerout");
		await advance(14_000);
		assert.equal(button.dataset.reaction, "playful");
		await event("pointerover");
		await advance(36_000);
		assert.equal(button.dataset.reaction, "curious");
	});
});

test("a rare reward needs four recent accepted loves and respects its cooldown", async () => {
	await fixture(async ({ button, event, advance }) => {
		const love = async () => {
			for (let i = 0; i < 3; i++) await event("click");
		};
		await love();
		for (let i = 0; i < 3; i++) await love();
		assert.equal(button.dataset.reaction, "happy");
		await advance(20_001);
		for (let i = 0; i < 4; i++) {
			if (i) await advance(2000);
			await love();
			assert.equal(button.dataset.reaction, i === 3 ? "starstruck" : "loved");
		}
		assert.equal(timers.size, 2);
		await advance(1699);
		assert.equal(button.dataset.reaction, "starstruck");
		await advance(1);
		assert.equal(button.dataset.reaction, "rest");
		for (let i = 0; i < 4; i++) {
			await advance(2000);
			await love();
			assert.equal(button.dataset.reaction, "loved");
		}
		await advance(60_000);
		for (let i = 0; i < 4; i++) {
			if (i) await advance(2000);
			await love();
			assert.equal(button.dataset.reaction, i === 3 ? "starstruck" : "loved");
		}
	});
});

test("carrying progresses on one clock even while the pointer keeps moving", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await event("pointerdown");
		await event("pointermove", { screenX: 110 });
		assert.equal(button.dataset.reaction, "grabbed");
		assert.equal(timers.size, 2);
		await advance(200);
		await event("pointermove", { screenX: 120 });
		await advance(50);
		assert.equal(button.dataset.reaction, "dragging");
		assert.equal(timers.size, 2);
		await event("pointerup", { pointerId: 2 });
		assert.equal(released(), null);
		await advance(900);
		await event("pointermove", { screenX: 90 });
		await advance(50);
		assert.equal(button.dataset.reaction, "struggling");
		assert.equal(timers.size, 1);
		await event("pointerup");
		assert.equal(released(), "drag");
		assert.equal(button.dataset.reaction, "landing");
		await advance(900);
		assert.equal(button.dataset.reaction, "rest");
	});
});

test("stationary holding pets the companion; unrelated pointers cannot release it", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await event("pointerdown");
		await advance(450);
		assert.equal(button.dataset.reaction, "happy");
		await event("pointermove", { pointerId: 2, screenX: 300 });
		await event("pointerup", { pointerId: 2 });
		assert.equal(released(), null);
		assert.equal(button.dataset.engaged, "true");
		await event("pointerup");
		assert.equal(released(), "tap");
		await advance(1200);
		assert.equal(button.dataset.reaction, "rest");
	});
});

test("head rub reversals give bounded joy while idle or complete", async () => {
	await fixture(async ({ button, event, advance, mood }) => {
		const rub = async () => {
			for (const screenX of [100, 120, 100, 120, 100])
				await event("pointermove", { screenX, clientY: 40 });
		};
		await rub();
		assert.equal(button.dataset.reaction, "loved");
		assert.equal(timers.size, 2);
		await advance(1000);
		await rub();
		await advance(200);
		assert.equal(button.dataset.reaction, "rest");
		await mood("working");
		await advance(1800);
		await rub();
		assert.equal(button.dataset.reaction, "rest");
		for (const state of ["idle", "complete"]) {
			await mood(state);
			await advance(2000);
			await rub();
			assert.equal(button.dataset.reaction, "loved");
		}
	});
});

test("idle and completed companions sleep, while live task states stay awake", async () => {
	await fixture(async ({ button, event, advance, mood, visibility }) => {
		await advance(89_999);
		assert.equal(button.dataset.reaction, "rest");
		await advance(1);
		assert.equal(button.dataset.reaction, "dozing");
		await event("pointerover");
		assert.equal(button.dataset.reaction, "waking");
		await advance(800);
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerout");
		await advance(90_000);
		assert.equal(button.dataset.reaction, "dozing");
		for (const state of ["working", "attention", "error", "offline"]) {
			await mood(state);
			await advance(100_000);
			assert.equal(button.dataset.reaction, "rest");
			assert.equal(timers.size, 0);
		}
		await mood("complete");
		await advance(89_999);
		assert.equal(button.dataset.reaction, "rest");
		await advance(1);
		assert.equal(button.dataset.reaction, "dozing");
		await event("pointerover");
		assert.equal(button.dataset.reaction, "waking");
		await advance(800);
		await event("pointerout");
		await mood("idle");
		await advance(90_000);
		await act(async () => button.focus());
		assert.equal(button.dataset.reaction, "waking");
		await visibility(true);
		await mood("working");
		await mood("idle");
		assert.equal(timers.size, 0);
		await visibility(false);
		await advance(90_000);
		assert.equal(button.dataset.reaction, "dozing");
	});
});

test("cancellation clears gestures and restarts sleep for visible companions", async () => {
	await fixture(async ({ button, event, advance, flush, released }) => {
		for (const [type, held] of [
			["pointercancel", 0],
			["lostpointercapture", 300],
			["blur", 1300],
		]) {
			await event("pointerdown");
			await event("pointermove", { screenX: 120 });
			await advance(held);
			button.setPointerCapture(1);
			if (type === "blur")
				await act(async () =>
					window.dispatchEvent(new dom.window.Event("blur")),
				);
			else await event(type);
			assert.equal(timers.size, 1);
			assert.equal(frames.size, 0);
			assert.equal(button.hasPointerCapture(1), false);
			await advance(100_000);
			await flush();
			await event("pointerup");
			assert.equal(released(), null);
			assert.equal(button.dataset.reaction, "dozing");
		}
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
		await event("pointerdown");
		await event("pointermove", { screenX: 120 });
		button.setPointerCapture(1);
		assert.equal(frames.size, 1);
		assert.equal(timers.size, 2);
	});
	assert.equal(frames.size, 0);
	assert.equal(timers.size, 0);
});
