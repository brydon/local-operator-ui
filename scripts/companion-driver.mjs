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
  const chatId = "abcdef123456";
  const chatRequests = [];
  const history = [];
  let streaming = false;
  let generation = 0;
  let pendingGate = null;
  let failSend = false;
  const requestDesktop = async input => {
    chatRequests.push(input);
    if (input.op === "sessions.create") return { status: 200, body: { result: { session_id: chatId } } };
    if (input.op === "sessions.get") return { status: 200, body: { result: {
      session_id: chatId,
      payload: { history: { entries: history }, frontend: { snapshot: {
        session_id: chatId, conversation_title: "A little help", streaming,
        epoch: "fixture", generation, pending_gate: pendingGate,
        last_turn_outcome: generation > 0 && !streaming ? "completed" : null,
        live_events: [],
      } } },
    } } };
    if (input.op === "sessions.message") {
      if (failSend) throw new Error("Fixture lost connection");
      history.push({ type: "message", id: input.requestId, payload: { role: "user", content: [{ text: input.text }] } });
      streaming = true;
      generation++;
      return { status: 200, body: { result: { status: "admitted", command_id: input.requestId } } };
    }
    throw new Error("Unexpected operation " + input.op);
  };
  companion = new DesktopCompanion({
    url, preload, preferencesPath: prefs, skinsDirectory: join(root, "skins"),
    headless: true, cwd: root, requestDesktop,
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
  await until(() => evaluate("document.querySelector('.companion-character')?.getAttribute('aria-label').includes('Ready')"), "catalogue status reaches renderer");
  assert.equal(window.isVisible(), false);
  assert.equal(window.isFocused(), false);
  assert.equal(await evaluate("typeof window.electron"), "undefined", "pet has no general app IPC bridge");
  assert.equal(await evaluate("typeof window.require"), "undefined");
  assert.equal(await evaluate("document.documentElement.scrollWidth"), 132);

  // A second renderer with the same preload cannot invoke this pet's capabilities.
  const outsider = new BrowserWindow({ show: false, focusable: false, webPreferences: { preload, sandbox: true, contextIsolation: true } });
  await outsider.loadURL(url);
  assert.equal(await outsider.webContents.executeJavaScript("window.companion.getState()"), null);
  assert.equal(await outsider.webContents.executeJavaScript("window.companion.getChat()"), null);
  assert.equal(await outsider.webContents.executeJavaScript("window.companion.sendMessage('unauthorized')"), false);
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

  catalogue = { result: { sessions: [] } };
  companion.refresh();
  await until(() => evaluate("document.querySelector('main')?.dataset.mood === 'idle'"), "hover idle");
  const hoverAt = (x, y) => evaluate("(() => { const pet = document.querySelector('.companion-character'); const b = pet.getBoundingClientRect(); pet.dispatchEvent(new PointerEvent('pointerover', {bubbles:true, pointerType:'mouse', clientX:b.left+b.width*" + x + ", clientY:b.top+b.height*" + y + "})); pet.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, pointerType:'mouse', clientX:b.left+b.width*" + x + ", clientY:b.top+b.height*" + y + "})); })()");
  await hoverAt(.1, .3);
  await until(() => evaluate("document.querySelector('.companion-character').dataset.reaction === 'curious'"), "hover reaction");
  await pause(250);
  const leftGaze = await evaluate("getComputedStyle(document.querySelector('.companion-art-gaze')).transform");
  writeFileSync(join(out, "hover-left.png"), (await window.webContents.capturePage()).toPNG());
  await hoverAt(.9, .7);
  await pause(250);
  const rightGaze = await evaluate("getComputedStyle(document.querySelector('.companion-art-gaze')).transform");
  assert.notEqual(leftGaze, rightGaze, "eyes follow the pointer across the pet");
  writeFileSync(join(out, "hover-right.png"), (await window.webContents.capturePage()).toPNG());
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.companion-art *')).filter(e=>getComputedStyle(e).animationName!=='none').map(e=>e.className.baseVal||e.className)"), [], "reduced motion has no animation loops");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.companion-art-gaze')).transform"), "none", "reduced motion prevents gaze tracking");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.companion-art-pose')).transform"), "none");
  window.webContents.debugger.detach();
  await evaluate("document.querySelector('.companion-character').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))");
  await pause();
  assert.equal(await evaluate("document.querySelector('.companion-chat').hidden"), true, "right-click does not open chat");
  assert.equal(window.isVisible(), false, "right-click cannot present a native menu in headless mode");

  catalogue = { result: { sessions: [{ id: "fixture-chat", status: { code: "approval" } }] } };
  companion.refresh();
  await until(() => evaluate("document.querySelector('main')?.dataset.mood === 'attention'"), "click target current");
  await evaluate("window.companion.openTask()");
  await until(() => opened.length === 1, "click opens chat");
  assert.equal(opened[0], "fixture-chat");
  const collapsedBounds = window.getBounds();
  await evaluate("document.querySelector('.companion-character').click()");
  await until(() => evaluate("!document.querySelector('.companion-chat').hidden"), "inline chat opens");
  assert.equal(opened.length, 1, "pet click keeps conversation beside pet");
  assert.equal(window.getBounds().width, 316);
  assert.equal(window.isVisible(), false, "opening chat cannot present a headless window");
  assert.equal(window.isFocused(), false);
  await until(() => window.getBounds().height < 240, "composer-only popup fits its content");
  assert.equal(await evaluate("document.querySelector('.companion-bubble')"), null);
  assert.equal(await evaluate("document.querySelector('.companion-chat-header')"), null);
  assert.equal(await evaluate("document.documentElement.scrollWidth > window.innerWidth"), false);
  const typeDraft = text => evaluate("Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(document.querySelector('textarea'), " + JSON.stringify(text) + "); document.querySelector('textarea').dispatchEvent(new Event('input', {bubbles:true}))");
  await typeDraft("Could you help me plan a quiet afternoon?");
  await evaluate("document.querySelector('[aria-label=\"Collapse chat\"]').click()");
  await until(() => window.getBounds().width === 132, "collapse window");
  assert.deepEqual(window.getBounds(), collapsedBounds, "collapse restores exact anchor");
  await until(() => evaluate("document.activeElement?.classList.contains('companion-character')"), "collapse returns keyboard focus to pet");
  await evaluate("document.querySelector('.companion-character').click()");
  await until(() => evaluate("!document.querySelector('.companion-chat').hidden"), "reopen draft");
  assert.equal(await evaluate("document.querySelector('textarea').value"), "Could you help me plan a quiet afternoon?");
  await pause(250);
  writeFileSync(join(out, "chat-draft.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('.companion-chat-send').click()");
  await until(() => evaluate("document.querySelector('textarea').value === ''"), "accepted send clears draft");
  assert.equal(chatRequests.filter(r => r.op === "sessions.message").length, 1);
  assert.equal(await evaluate("document.querySelector('.companion-chat-send').disabled"), true);
  history.push({ type: "message", id: "reply-1", payload: { role: "assistant", content: [{ text: "Take a short walk, make a cup of tea, and leave one hour free for something you enjoy." }] } });
  streaming = false;
  catalogue = { result: { sessions: [{ id: chatId, status: { code: "complete" }, attention: { unseen: true } }] } };
  companion.refresh();
  await until(() => evaluate("document.querySelector('.companion-chat-reply')?.textContent.includes('Take a short walk')"), "durable reply appears");
  await pause(250);
  writeFileSync(join(out, "chat-reply-light.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("localStorage.setItem('ui-preferences-storage', JSON.stringify({state:{themeName:'localOperatorDark'}})); window.dispatchEvent(new StorageEvent('storage'))");
  await pause(250);
  writeFileSync(join(out, "chat-reply-dark.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('[aria-label=\"Open chat in the full app\"]').click()");
  await until(() => opened.length === 2, "expand conversation");
  assert.equal(opened[1], chatId);
  pendingGate = { type: "approval" };
  companion.refresh();
  await until(() => evaluate("!!document.querySelector('.companion-chat-attention')"), "approval handoff");
  await pause(250);
  assert.equal(await evaluate("document.querySelector('.companion-chat-send').disabled"), true);
  writeFileSync(join(out, "chat-attention.png"), (await window.webContents.capturePage()).toPNG());
  pendingGate = null;
  companion.refresh();
  await until(() => evaluate("!document.querySelector('.companion-chat-attention')"), "gate clears");
  await pause(250);
  failSend = true;
  await typeDraft("A second thought");
  await evaluate("document.querySelector('.companion-chat-send').click()");
  await until(() => evaluate("document.querySelector('.companion-chat-error')?.textContent.includes('confirm')"), "uncertain send explanation");
  assert.equal(await evaluate("document.querySelector('textarea').value"), "A second thought");
  writeFileSync(join(out, "chat-unconfirmed.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('[aria-label=\"Collapse chat\"]').click()");
  await until(() => window.getBounds().width === 132, "collapse before move");
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
  await evaluate("window.companion.hide()");
  await until(() => !companion.enabled, "hide control");
  assert.equal(pet(), window);
  assert.equal(window.isVisible(), false);
  assert.equal(await evaluate("window.companion.getChat()"), null, "hidden companion refuses IPC");
  const pausedCalls = calls;
  await pause(350);
  assert.equal(calls, pausedCalls, "hidden pet stops polling");
  companion.setEnabled(true);
  window = pet();
  await until(() => window.webContents.executeJavaScript("!!document.querySelector('.companion-custom-art')").catch(() => false), "custom selection survives show");
  assert.deepEqual(window.getPosition(), [savedPosition.x, savedPosition.y]);
  assert.equal(companion.appearance.id, selected);
  await evaluate("document.querySelector('.companion-character').click()");
  await until(() => evaluate("!document.querySelector('.companion-chat').hidden"), "show retains chat");
  assert.equal(await evaluate("document.querySelector('textarea').value"), "A second thought", "hide/show preserves unconfirmed send draft");
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
      writeFileSync(join(out, "verification.json"), JSON.stringify({ passed: true, electron: process.versions.electron, captures: 26, checks: ["sandboxed renderer", "foreign sender rejection", "isolated zoom", "six real catalogue states", "three characters", "theme sync", "reduced motion", "task context action", "hover follows pointer", "headless right-click remains hidden", "compact intrinsic chat sizing", "inline chat and real IPC", "draft survives collapse", "admitted send and durable reply", "ambiguous send preserves draft", "approval handoff", "expand exact conversation", "keyboard move and position persistence", "custom PNG import and fallback", "hide stops polling", "native close", "actual Electron quit preserves next-launch visibility"] }, null, 2));
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
