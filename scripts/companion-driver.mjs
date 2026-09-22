#!/usr/bin/env node
// Exercise the real Electron window, preload and renderer without presenting a window.
// Run after pnpm build: node scripts/companion-driver.mjs --out /tmp/companion-frames
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const repo = process.cwd();
const outputFlag = process.argv.indexOf("--out");
assert.ok(
	outputFlag < 0 || process.argv[outputFlag + 1],
	"Pass --out followed by a directory",
);
const output = resolve(
	outputFlag < 0 ? "/tmp/companion-frames" : process.argv[outputFlag + 1],
);
mkdirSync(output, { recursive: true });
rmSync(join(output, "verification.json"), { force: true });
const scratch = mkdtempSync(join(tmpdir(), "local-operator-companion-"));
const entry = join(scratch, "driver.cjs");
const source = String.raw`
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, screen } from "electron";
import { DesktopCompanion } from "./src/main/desktop-companion";

const repo = process.env.COMPANION_REPO;
const root = process.env.COMPANION_SCRATCH;
const out = process.env.COMPANION_OUTPUT;
app.setPath("userData", join(root, "profile"));
app.on("window-all-closed", () => {});
const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(); }
  throw new Error("Timed out: " + description);
}
let companion;
async function run() {
  await app.whenReady();
  mkdirSync(app.getPath("userData"), { recursive: true });
  let catalogue = { result: { sessions: [] } };
  let calls = 0;
  const opened = [];
  const visibility = [];
  const errors = [];
  const url = pathToFileURL(join(repo, "out/renderer/companion.html")).href;
  const preload = join(repo, "out/preload/companion.js");
  const prefs = join(root, "companion.json");
  companion = new DesktopCompanion({
    url, preload, preferencesPath: prefs, skinsDirectory: join(root, "skins"),
    headless: true,
    readCatalogue: async () => { calls++; return { status: 200, body: catalogue }; },
    openChat: id => opened.push(id),
    visibilityChanged: enabled => visibility.push(enabled),
    appearanceChanged: () => {}, report: message => console.log(message),
  });
  const pet = () => BrowserWindow.getAllWindows().find(w => w.getTitle() === "Local Operator companion");
  let window = pet();
  window.webContents.on("console-message", details => { if (details.level === "error") errors.push(details.message); });
  const evaluate = script => window.webContents.executeJavaScript(script);
  await until(() => evaluate("!!document.querySelector('.companion-art')").catch(() => false), "pet mounts");
  await until(() => evaluate("document.querySelector('output')?.textContent === 'Ready'"), "catalogue status reaches renderer");
  assert.equal(window.isVisible(), false);
  assert.equal(window.isFocused(), false);
  assert.equal(await evaluate("typeof window.electron"), "undefined", "pet has no general app IPC bridge");
  assert.equal(await evaluate("typeof window.require"), "undefined");
  assert.equal(await evaluate("document.documentElement.scrollWidth"), 216);

  // A second renderer with the same preload cannot invoke this pet's capabilities.
  const outsider = new BrowserWindow({ show: false, focusable: false, webPreferences: { preload, sandbox: true, contextIsolation: true } });
  await outsider.loadURL(url);
  assert.equal(await outsider.webContents.executeJavaScript("window.companion.getState()"), null);
  await outsider.webContents.executeJavaScript("window.companion.openChat(); window.companion.hide()");
  await pause();
  assert.equal(opened.length, 0);
  assert.equal(companion.enabled, true);
  outsider.webContents.setZoomFactor(1.5);
  assert.equal(window.webContents.getZoomFactor(), 1, "pet zoom is isolated from other windows");

  const codes = { idle: "idle", working: "busy", attention: "approval", complete: "complete", error: "error", offline: "future-code" };
  for (const character of ["sprout", "hoodie", "pixel"]) {
    companion.selectCharacter(character);
    await until(() => evaluate("!!document.querySelector('.companion-art-" + character + "')"), "character switch");
    for (const [mood, code] of Object.entries(codes)) {
      catalogue = { result: { sessions: [{ id: "fixture-chat", status: { code }, attention: { unseen: true } }] } };
      companion.refresh();
      await until(() => evaluate("document.querySelector('main')?.dataset.mood === '" + mood + "'"), "mood " + mood);
      await pause(70);
      writeFileSync(join(out, character + "-" + mood + ".png"), (await window.webContents.capturePage()).toPNG());
    }
  }
  // Shared theme preferences are observed without mounting the main app's stores.
  await outsider.webContents.executeJavaScript("localStorage.setItem('ui-preferences-storage', JSON.stringify({state:{themeName:'localOperatorLight'}}))");
  await until(() => evaluate("document.documentElement.dataset.theme === 'localOperatorLight'"), "theme storage sync");
  writeFileSync(join(out, "pixel-light.png"), (await window.webContents.capturePage()).toPNG());
  outsider.destroy();

  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.companion-art *')).filter(e=>getComputedStyle(e).animationName!=='none').map(e=>e.className.baseVal||e.className)"), [], "reduced motion has no animation loops");
  window.webContents.debugger.detach();

  catalogue = { result: { sessions: [{ id: "fixture-chat", status: { code: "approval" } }] } };
  companion.refresh();
  await until(() => evaluate("document.querySelector('main')?.dataset.mood === 'attention'"), "click target current");
  await evaluate("document.querySelector('.companion-status').click()");
  await until(() => opened.length === 1, "click opens chat");
  assert.equal(opened[0], "fixture-chat");
  const position = window.getPosition();
  await evaluate("window.companion.nudge('ArrowLeft')");
  await until(() => window.getPosition()[0] !== position[0], "keyboard move");
  const savedPosition = JSON.parse(readFileSync(prefs, "utf8")).position;
  const area = screen.getDisplayMatching(window.getBounds()).workArea;
  assert.ok(savedPosition.x >= area.x && savedPosition.y >= area.y);

  const pack = join(root, "sample");
  mkdirSync(pack);
  const png = (await window.webContents.capturePage()).toPNG();
  writeFileSync(join(pack, "idle.png"), png);
  writeFileSync(join(pack, "companion.json"), JSON.stringify({ version: 1, name: "Fixture pet", frames: { idle: "idle.png" } }));
  companion.importCharacter(join(pack, "companion.json"));
  await until(() => evaluate("document.querySelector('.companion-custom-art')?.complete === true"), "custom PNG loads and falls back to idle pose");
  assert.match(companion.appearance.id, /^custom-/);
  const selected = companion.appearance.id;
  await evaluate("document.querySelector('.companion-hide').click()");
  await until(() => !companion.enabled, "hide control");
  assert.equal(pet(), undefined);
  const pausedCalls = calls;
  await pause(350);
  assert.equal(calls, pausedCalls, "hidden pet stops polling");
  companion.setEnabled(true);
  window = pet();
  await until(() => window.webContents.executeJavaScript("!!document.querySelector('.companion-custom-art')").catch(() => false), "custom selection survives show");
  assert.deepEqual(window.getPosition(), [savedPosition.x, savedPosition.y]);
  assert.equal(companion.appearance.id, selected);
  window.close();
  await until(() => !companion.enabled, "native close keeps visibility preference honest");
  assert.equal(visibility.at(-1), false);
  assert.deepEqual(errors, []);
  // Actual Electron quit ordering: before-quit, window closes, then will-quit.
  companion.setEnabled(true);
  await until(() => pet()?.webContents.getURL() === url, "quit fixture reloads");
  app.once("before-quit", () => companion.dispose());
  return new Promise(resolveQuit => {
    app.once("will-quit", () => {
      assert.equal(JSON.parse(readFileSync(prefs, "utf8")).enabled, true, "ordinary Quit preserves companion visibility for next launch");
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      writeFileSync(join(out, "verification.json"), JSON.stringify({ passed: true, electron: process.versions.electron, captures: 19, checks: ["sandboxed renderer", "foreign sender rejection", "isolated zoom", "six real catalogue states", "three characters", "theme sync", "reduced motion", "chat click", "keyboard move and position persistence", "custom PNG import and fallback", "hide stops polling", "native close", "actual Electron quit preserves next-launch visibility"] }, null, 2));
      console.log("COMPANION_DRIVER_OK");
      resolveQuit();
    });
    app.quit();
  });
}
run().then(() => app.exit(0)).catch(error => { console.error(error); companion?.dispose(); app.exit(1); });
`;
try {
	await build({
		stdin: { contents: source, resolveDir: repo, loader: "ts" },
		bundle: true,
		platform: "node",
		format: "cjs",
		external: ["electron"],
		outfile: entry,
	});
	const binary = createRequire(join(repo, "package.json"))("electron");
	const child = spawn(
		binary,
		[entry, `--user-data-dir=${join(scratch, "profile")}`],
		{
			cwd: scratch,
			stdio: "inherit",
			env: {
				...process.env,
				HOME: scratch,
				LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
				LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
				COMPANION_REPO: repo,
				COMPANION_SCRATCH: scratch,
				COMPANION_OUTPUT: output,
			},
		},
	);
	const timer = setTimeout(() => child.kill("SIGTERM"), 45000);
	const code = await new Promise((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", resolveExit);
	});
	clearTimeout(timer);
	assert.equal(code, 0, "Companion Electron checks must pass");
	assert.equal(
		JSON.parse(readFileSync(join(output, "verification.json"), "utf8")).passed,
		true,
		"The renderer checks must reach their final assertion",
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
