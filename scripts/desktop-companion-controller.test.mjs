import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

// These tests exercise the shipped controller at the Electron boundary. No app,
// real window, native dialog, backend request, or desktop notification is started.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bundle = buildSync({
	entryPoints: [join(root, "src/main/desktop-companion.ts")],
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	external: ["electron"],
}).outputFiles[0].text;

function fixture(t, { headless = true } = {}) {
	const directory = mkdtempSync(join(tmpdir(), "companion-controller-"));
	const preferencesPath = join(directory, "preferences.json");
	const handlers = new Map();
	const ipcMain = new EventEmitter();
	ipcMain.handle = (name, handler) => handlers.set(name, handler);
	ipcMain.removeHandler = (name) => handlers.delete(name);
	const timeouts = new Map();
	const intervals = new Map();
	let timerId = 0;
	const windows = [];
	let cursor = { x: 400, y: 400 };
	const screen = new EventEmitter();
	screen.getPrimaryDisplay = screen.getDisplayMatching = () => ({
		workArea: { x: 0, y: 0, width: 1920, height: 1080 },
	});
	screen.getCursorScreenPoint = () => cursor;
	class FakeWindow extends EventEmitter {
		constructor(options) {
			super();
			this.options = options;
			this.position = [options.x, options.y];
			this.destroyed = false;
			this.presentations = [];
			this.messages = [];
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = { url: "" };
			this.webContents.send = (...message) => this.messages.push(message);
			this.webContents.setWindowOpenHandler = (handler) => {
				this.popup = handler;
			};
			windows.push(this);
		}
		loadURL(url) {
			this.webContents.mainFrame.url = url;
			return Promise.resolve();
		}
		isDestroyed() {
			return this.destroyed;
		}
		isMinimized() {
			return false;
		}
		setVisibleOnAllWorkspaces(...args) {
			this.workspaces = args;
		}
		setIgnoreMouseEvents(value) {
			this.ignoresMouse = value;
		}
		setPosition(x, y) {
			assert.ok(Number.isFinite(x) && Number.isFinite(y));
			this.position = [x, y];
		}
		getPosition() {
			return this.position;
		}
		destroy() {
			if (this.destroyed) return;
			this.destroyed = true;
			this.emit("closed");
		}
		showInactive() {
			this.presentations.push("inactive");
		}
		show() {
			this.presentations.push("focus");
		}
		focus() {
			this.presentations.push("focus");
		}
	}
	const module = { exports: {} };
	runInNewContext(bundle, {
		module,
		exports: module.exports,
		require: (name) =>
			name === "electron"
				? { ipcMain, BrowserWindow: FakeWindow, screen }
				: require(name),
		process,
		console,
		Buffer,
		setTimeout: (fn) => {
			const id = ++timerId;
			timeouts.set(id, fn);
			return id;
		},
		clearTimeout: (id) => timeouts.delete(id),
		setInterval: (fn) => {
			const id = ++timerId;
			intervals.set(id, fn);
			return id;
		},
		clearInterval: (id) => intervals.delete(id),
	});
	const requests = [];
	const opened = [];
	const visibility = [];
	const companion = new module.exports.DesktopCompanion({
		url: "file:///test/companion.html",
		preload: "/test/companion.js",
		preferencesPath,
		skinsDirectory: join(directory, "skins"),
		headless,
		readCatalogue: () =>
			new Promise((resolve, reject) => requests.push({ resolve, reject })),
		openChat: (id) => opened.push(id),
		visibilityChanged: (enabled) => visibility.push(enabled),
		appearanceChanged: () => {},
		report: () => {},
	});
	t.after(() => {
		companion.dispose();
		rmSync(directory, { recursive: true, force: true });
	});
	const trusted = (window = windows.at(-1)) => ({
		sender: window.webContents,
		senderFrame: window.webContents.mainFrame,
	});
	return {
		companion,
		windows,
		handlers,
		ipcMain,
		screen,
		requests,
		opened,
		visibility,
		intervals,
		timeouts,
		preferences: () => JSON.parse(readFileSync(preferencesPath, "utf8")),
		trusted,
		state: () => handlers.get("companion:get-state")(trusted()),
		action: (action, value, event = trusted()) =>
			ipcMain.emit("companion:action", event, action, value),
		cursor: (point) => {
			cursor = point;
		},
		flush: async () => {
			for (const [id, callback] of [...timeouts]) {
				timeouts.delete(id);
				callback();
			}
			await settle();
		},
	};
}

function catalogue(code, id = "session-a") {
	return {
		status: 200,
		body: {
			result: {
				sessions: [{ id, status: { code }, attention: { unseen: true } }],
				degraded: [],
			},
		},
	};
}

test("headless companion never presents or changes desktop workspaces", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	window.emit("ready-to-show");
	assert.equal(window.options.show, false);
	assert.equal(window.options.focusable, false);
	assert.equal(window.options.webPreferences.zoomMode, "isolated");
	assert.equal(window.options.webPreferences.zoomFactor, 1);
	assert.deepEqual(window.presentations, []);
	assert.equal(window.workspaces, undefined);
});

test("visible companion presents once without focus and accepts the first click", (t) => {
	const f = fixture(t, { headless: false });
	const window = f.windows[0];
	window.emit("ready-to-show");
	window.emit("ready-to-show");
	assert.deepEqual(window.presentations, ["inactive"]);
	assert.equal(window.options.acceptFirstMouse, true);
	assert.equal(window.options.focusable, true);
	assert.equal(window.workspaces[1].skipTransformProcessType, true);
	if (process.platform === "darwin") assert.equal(window.options.type, "panel");
});

test("IPC requires this companion's exact top-level document and rejects malformed actions", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	assert.equal(window.options.webPreferences.sandbox, true);
	assert.equal(window.options.webPreferences.nodeIntegration, false);
	assert.equal(window.options.webPreferences.contextIsolation, true);
	assert.equal(window.popup().action, "deny");
	for (const channel of ["will-navigate", "will-attach-webview"]) {
		let prevented = false;
		window.webContents.emit(channel, {
			preventDefault: () => {
				prevented = true;
			},
		});
		assert.equal(prevented, true);
	}
	for (const event of [
		{ sender: {}, senderFrame: window.webContents.mainFrame },
		{
			sender: window.webContents,
			senderFrame: { url: "file:///test/companion.html" },
		},
		{ sender: window.webContents, senderFrame: null },
	]) {
		f.action("open", undefined, event);
		f.action("hide", undefined, event);
		assert.equal(f.handlers.get("companion:get-state")(event), null);
		assert.equal(f.handlers.get("companion:get-appearance")(event), null);
	}
	window.webContents.mainFrame.url = "https://example.invalid/";
	f.action("open");
	assert.equal(f.handlers.get("companion:get-state")(f.trusted()), null);
	window.webContents.mainFrame.url = "file:///test/companion.html";
	const position = [...window.position];
	for (const value of [
		"__proto__",
		"constructor",
		"toString",
		"noSuchArrow",
		null,
		{},
		42,
	]) {
		assert.doesNotThrow(() => f.action("nudge", value));
	}
	f.action("interactive", "true");
	f.action("drag", "unexpected");
	f.action("unknown-action", "open");
	assert.equal(f.companion.enabled, true);
	assert.equal(window.ignoresMouse, true);
	assert.deepEqual(window.position, position);
	assert.deepEqual(f.opened, []);
	f.action("open");
	assert.deepEqual(f.opened, [null]);
});

test("catalogue reads coalesce and serialize, then reject responses from a disabled generation", async (t) => {
	const f = fixture(t);
	f.companion.refresh();
	f.companion.refresh();
	await f.flush();
	assert.equal(f.requests.length, 1);
	f.companion.refresh();
	f.companion.refresh();
	assert.equal(f.timeouts.size, 0);
	f.requests.shift().resolve(catalogue("busy"));
	await settle();
	assert.equal(f.state().mood, "working");
	await f.flush();
	assert.equal(f.requests.length, 1);
	const oldWindow = f.windows[0];
	f.companion.setEnabled(false);
	f.companion.setEnabled(true);
	f.requests.shift().resolve(catalogue("complete", "old-session"));
	await settle();
	assert.equal(
		f.windows
			.at(-1)
			.messages.some((message) => message[1]?.sessionId === "old-session"),
		false,
	);
	await f.flush();
	assert.equal(f.requests.length, 1);
	f.requests.shift().resolve(catalogue("approval", "new-session"));
	await settle();
	assert.equal(f.state().sessionId, "new-session");
	f.action("hide", undefined, f.trusted(oldWindow));
	assert.equal(f.companion.enabled, true);
	f.companion.refresh();
	await f.flush();
	f.requests.shift().reject(new Error("Connection lost"));
	await settle();
	assert.equal(f.state().mood, "offline");
	assert.equal(f.state().sessionId, null);
});

test("dragging moves and saves without opening chat; clicking opens the observed session", async (t) => {
	const f = fixture(t);
	await f.flush();
	f.requests.shift().resolve(catalogue("busy"));
	await settle();
	const window = f.windows[0];
	const [x, y] = window.position;
	f.cursor({ x: 400, y: 400 });
	f.action("drag", "start");
	f.action("interactive", false);
	assert.equal(window.ignoresMouse, false);
	f.cursor({ x: 360, y: 350 });
	f.action("drag", "move");
	f.action("drag", "end");
	assert.deepEqual(window.position, [x - 40, y - 50]);
	assert.deepEqual(f.preferences().position, { x: x - 40, y: y - 50 });
	assert.deepEqual(f.opened, []);
	f.action("drag", "start");
	f.action("drag", "end");
	assert.deepEqual(f.opened, ["session-a"]);
	f.action("drag", "start");
	window.emit("blur");
	f.action("drag", "end");
	assert.equal(f.opened.length, 1);
	f.action("interactive", false);
	assert.equal(window.ignoresMouse, true);
	f.action("interactive", true);
	assert.equal(window.ignoresMouse, false);
	f.action("nudge", "ArrowLeft");
	assert.equal(window.position[0], x - 64);
});

test("native close disables the companion, cancels polling and persists the menu state", (t) => {
	const f = fixture(t);
	assert.equal(f.intervals.size, 1);
	assert.equal(f.timeouts.size, 1);
	f.windows[0].destroy();
	assert.equal(f.companion.enabled, false);
	assert.equal(f.preferences().enabled, false);
	assert.equal(f.visibility.at(-1), false);
	assert.equal(f.intervals.size, 0);
	assert.equal(f.timeouts.size, 0);
	f.companion.refresh();
	assert.equal(f.timeouts.size, 0);
	f.companion.setEnabled(true);
	assert.equal(f.windows.length, 2);
	assert.equal(f.intervals.size, 1);
});

test("disposal unregisters IPC and display observers without disabling the next launch", (t) => {
	const f = fixture(t);
	f.companion.dispose();
	assert.equal(f.windows[0].destroyed, true);
	assert.equal(f.preferences().enabled, true);
	assert.equal(f.handlers.size, 0);
	assert.equal(f.ipcMain.listenerCount("companion:action"), 0);
	assert.equal(f.screen.listenerCount("display-removed"), 0);
	assert.equal(f.screen.listenerCount("display-metrics-changed"), 0);
	assert.equal(f.intervals.size, 0);
	assert.equal(f.timeouts.size, 0);
});
