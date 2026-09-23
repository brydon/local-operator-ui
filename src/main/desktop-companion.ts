import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { BrowserWindow, Menu, dialog, ipcMain, screen } from "electron";
import type {
	IpcMainEvent,
	IpcMainInvokeEvent,
	MenuItemConstructorOptions,
} from "electron";
import {
	BUILTIN_COMPANIONS,
	type CompanionAppearance,
} from "../shared/companion-skin";
import {
	COMPANION_CHAT_SIZE,
	COMPANION_DRAG_THRESHOLD,
	COMPANION_OFFLINE,
	COMPANION_SIZE,
	type CompanionActivity,
	type CompanionPreferences,
	type CompanionState,
	clampCompanionPosition,
	companionPreferences,
	companionStateFromCatalogue,
} from "../shared/desktop-companion";
import { CompanionChatService } from "./companion-chat";
import { CompanionSkinLibrary } from "./companion-skins";
import { presentWindow, raiseWindow } from "./window-raise";

interface CompanionOptions {
	url: string;
	preload: string;
	preferencesPath: string;
	skinsDirectory: string;
	headless: boolean;
	cwd: string;
	requestDesktop(input: unknown): Promise<{ status: number; body: unknown }>;
	readCatalogue(): Promise<{ status: number; body: unknown }>;
	openChat(sessionId: string | null): void;
	visibilityChanged(enabled: boolean): void;
	appearanceChanged(): void;
	report(message: string): void;
}

export class DesktopCompanion {
	private window: BrowserWindow | null = null;
	private chat: CompanionChatService;
	private chatOpen = false;
	private chatHeight = COMPANION_CHAT_SIZE.height;
	private preferences: CompanionPreferences;
	private skins: CompanionSkinLibrary;
	private state: CompanionState = COMPANION_OFFLINE;
	private poll: ReturnType<typeof setInterval> | null = null;
	private debounce: ReturnType<typeof setTimeout> | null = null;
	private refreshing = false;
	private dirty = false;
	private generation = 0;
	private disposed = false;
	private reducedMotion = true;
	private drop: { timer: ReturnType<typeof setTimeout> | null } | null = null;
	private dragOrigin: {
		cursor: Electron.Point;
		position: Electron.Point;
		moved: boolean;
	} | null = null;

	constructor(private readonly options: CompanionOptions) {
		this.onDisplayChanged = this.onDisplayChanged.bind(this);
		this.onAction = this.onAction.bind(this);
		this.skins = new CompanionSkinLibrary(options.skinsDirectory);
		this.chat = new CompanionChatService({
			requestDesktop: options.requestDesktop,
			cwd: options.cwd,
			onChange: () => this.publishChat(),
		});
		try {
			this.preferences = companionPreferences(
				JSON.parse(readFileSync(options.preferencesPath, "utf8")),
			);
		} catch {
			this.preferences = companionPreferences(null);
		}
		ipcMain.handle("companion:get-state", (event) =>
			this.trusted(event) ? this.state : null,
		);
		ipcMain.handle("companion:get-appearance", (event) =>
			this.trusted(event) ? this.appearance : null,
		);
		ipcMain.handle("companion:get-chat", (event) =>
			this.trusted(event)
				? { open: this.chatOpen, snapshot: this.chat.snapshot }
				: null,
		);
		ipcMain.handle("companion:send", async (event, text: unknown) => {
			if (!this.trusted(event) || !this.chatOpen || typeof text !== "string")
				return false;
			return (await this.chat.send(text)).accepted;
		});
		ipcMain.on("companion:action", this.onAction);
		screen.on("display-removed", this.onDisplayChanged);
		screen.on("display-metrics-changed", this.onDisplayChanged);
		this.setEnabled(this.preferences.enabled);
	}

	get enabled(): boolean {
		return this.preferences.enabled;
	}
	get characters(): Array<{ id: string; name: string }> {
		return this.skins.list();
	}
	get appearance(): CompanionAppearance {
		return this.skins.get(this.preferences.character) ?? BUILTIN_COMPANIONS[0];
	}

	selectCharacter(id: string): void {
		if (!this.characters.some((item) => item.id === id)) return;
		this.preferences.character = id;
		this.save();
		this.options.appearanceChanged();
		if (this.window && !this.window.isDestroyed())
			this.window.webContents.send("companion:appearance", this.appearance);
	}

	importCharacter(path: string, replaceId?: string): void {
		const appearance = this.skins.import(path, replaceId);
		this.selectCharacter(appearance.id);
	}

	get characterMenu(): MenuItemConstructorOptions[] {
		const selected = this.appearance.id;
		const custom = !BUILTIN_COMPANIONS.some((item) => item.id === selected);
		return [
			...this.characters.map((character) => ({
				label: character.name,
				type: "radio" as const,
				checked: character.id === selected,
				click: () => this.selectCharacter(character.id),
			})),
			{ type: "separator" },
			{ label: "Add character…", click: () => this.chooseCharacter() },
			...(custom
				? [
						{
							label: "Replace artwork…",
							click: () => this.chooseCharacter(selected),
						},
						{
							label: "Remove character",
							click: () => {
								try {
									this.removeCharacter(selected);
								} catch (error) {
									void this.showCharacterError(error);
								}
							},
						},
					]
				: []),
		];
	}

	removeCharacter(id: string): void {
		if (!this.skins.remove(id)) return;
		if (this.preferences.character === id)
			this.selectCharacter(BUILTIN_COMPANIONS[0].id);
		else this.options.appearanceChanged();
	}

	private async chooseCharacter(replaceId?: string): Promise<void> {
		if (this.disposed || this.options.headless) return;
		try {
			const chosen = await dialog.showOpenDialog({
				title: replaceId
					? "Replace companion artwork"
					: "Add a companion character",
				buttonLabel: replaceId ? "Replace artwork" : "Add character",
				properties: ["openFile"],
				filters: [{ name: "Companion character", extensions: ["json", "png"] }],
			});
			if (this.disposed || chosen.canceled || !chosen.filePaths[0]) return;
			this.importCharacter(chosen.filePaths[0], replaceId);
		} catch (error) {
			await this.showCharacterError(error);
		}
	}

	private async showCharacterError(error: unknown): Promise<void> {
		if (this.disposed || this.options.headless) return;
		await dialog.showMessageBox({
			type: "error",
			title: "Character could not be changed",
			message:
				error instanceof Error
					? error.message
					: "Check the character manifest and images.",
		});
	}

	private trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
		return (
			this.enabled &&
			!!this.window &&
			!this.window.isDestroyed() &&
			event.sender === this.window.webContents &&
			event.senderFrame === this.window.webContents.mainFrame &&
			event.senderFrame?.url === this.options.url
		);
	}

	setEnabled(enabled: boolean): void {
		if (this.disposed) return;
		const wasEnabled = this.preferences.enabled;
		this.preferences.enabled = enabled;
		this.save();
		this.options.visibilityChanged(enabled);
		if (!enabled) {
			this.cancelDrop();
			this.stopPolling();
			this.dragOrigin = null;
			this.layoutChat(false);
			this.chatOpen = false;
			this.window?.hide();
			return;
		}
		if (this.window && !this.window.isDestroyed()) {
			if (wasEnabled) return;
			this.present();
		} else {
			this.createWindow();
		}
		this.poll = setInterval(() => this.refresh(), 5000);
		this.refresh();
	}

	private createWindow(): void {
		this.reducedMotion = true;
		const area = screen.getPrimaryDisplay().workArea;
		const point = this.preferences.position ?? {
			x: area.x + area.width - COMPANION_SIZE.width - 24,
			y: area.y + area.height - COMPANION_SIZE.height - 24,
		};
		const position = this.clamp(point);
		const window = new BrowserWindow({
			...COMPANION_SIZE,
			...position,
			title: "Local Operator companion",
			show: false,
			acceptFirstMouse: true,
			// Use a normal window: macOS panels skip show/focus activation.
			focusable: !this.options.headless,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			hasShadow: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			resizable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			webPreferences: {
				preload: this.options.preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				zoomMode: "isolated",
				zoomFactor: 1,
				backgroundThrottling: !this.options.headless,
			},
		});
		this.window = window;
		if (!this.options.headless)
			window.setVisibleOnAllWorkspaces(true, {
				visibleOnFullScreen: true,
				skipTransformProcessType: true,
			});
		window.setIgnoreMouseEvents(true, { forward: true });
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		window.webContents.on("will-attach-webview", (event) =>
			event.preventDefault(),
		);
		window.once("ready-to-show", () => {
			if (this.enabled && this.window === window) this.present();
		});
		window.on("blur", () => {
			this.cancelDrop();
			this.finishDrag();
		});
		window.on("closed", () => {
			if (this.window === window) {
				this.window = null;
				if (!this.disposed && this.enabled) this.setEnabled(false);
			}
		});
		void window
			.loadURL(this.options.url)
			.catch(() => this.options.report("Companion document could not load"));
	}

	private present(): void {
		if (!this.window) return;
		presentWindow(this.window, this.options.headless ? "never" : "inactive", {
			trigger: "companion-present",
			report: this.options.report,
		});
	}

	private stopPolling(): void {
		this.generation++;
		if (this.poll) clearInterval(this.poll);
		if (this.debounce) clearTimeout(this.debounce);
		this.poll = null;
		this.debounce = null;
	}

	/** Coalesce feed events while keeping catalogue reads sequential. */
	refresh(): void {
		if (!this.enabled || this.disposed || this.debounce) return;
		if (this.refreshing) {
			this.dirty = true;
			return;
		}
		this.debounce = setTimeout(() => {
			this.debounce = null;
			void this.read();
		}, 200);
	}

	private async read(): Promise<void> {
		this.refreshing = true;
		this.dirty = false;
		const generation = this.generation;
		let next: CompanionState;
		try {
			const response = await this.options.readCatalogue();
			next =
				response.status === 200
					? companionStateFromCatalogue(response.body)
					: { ...COMPANION_OFFLINE, label: "Not connected" };
		} catch {
			next = { ...COMPANION_OFFLINE, label: "Not connected" };
		}
		this.refreshing = false;
		if (this.enabled && !this.disposed && generation === this.generation) {
			this.state = next;
			if (this.window && !this.window.isDestroyed())
				this.window.webContents.send("companion:state", next);
			if (this.chatOpen) void this.chat.refresh();
		}
		if (this.dirty) this.refresh();
	}

	private publishChat(): void {
		if (this.window && !this.window.isDestroyed())
			this.window.webContents.send("companion:chat", {
				open: this.chatOpen,
				snapshot: this.chat.snapshot,
			});
	}

	private showChat(): void {
		if (!this.window) return;
		this.layoutChat(true);
		void this.chat.open();
		raiseWindow(this.window, this.options.headless ? "never" : "focus", {
			trigger: "companion-chat",
			report: this.options.report,
		});
	}

	/** Keep the lower-right anchor stable through expansion, collapse and dragging. */
	private layoutChat(open: boolean): void {
		this.cancelDrop();
		if (!this.window) return;
		const bounds = this.window.getBounds();
		const area = screen.getDisplayMatching(bounds).workArea;
		const target = open
			? { width: COMPANION_CHAT_SIZE.width, height: this.chatHeight }
			: COMPANION_SIZE;
		const size = {
			width: Math.min(target.width, area.width),
			height: Math.min(target.height, area.height),
		};
		const point = clampCompanionPosition(
			{
				x: bounds.x + bounds.width - size.width,
				y: bounds.y + bounds.height - size.height,
			},
			area,
			size,
		);
		this.chatOpen = open;
		this.window.setBounds({ ...point, ...size }, false);
		this.rememberPosition();
		this.save();
		this.publishChat();
	}

	private clamp(point: Electron.Point): Electron.Point {
		const bounds = this.window?.getBounds() ?? COMPANION_SIZE;
		const size = { width: bounds.width, height: bounds.height };
		const area = screen.getDisplayMatching({ ...point, ...size }).workArea;
		return clampCompanionPosition(point, area, size);
	}

	private rememberPosition(): void {
		if (!this.window) return;
		const bounds = this.window.getBounds();
		this.preferences.position = {
			x: bounds.x + bounds.width - COMPANION_SIZE.width,
			y: bounds.y + bounds.height - COMPANION_SIZE.height,
		};
	}

	private move(point: Electron.Point): void {
		const position = this.clamp(point);
		this.window?.setPosition(position.x, position.y, false);
		this.rememberPosition();
	}

	private onDisplayChanged(): void {
		this.layoutChat(this.chatOpen);
	}

	private cancelDrop(): void {
		if (!this.drop) return;
		if (this.drop.timer !== null) clearTimeout(this.drop.timer);
		this.drop = null;
		this.rememberPosition();
		this.save();
		if (this.window && !this.window.isDestroyed())
			this.window.webContents.send("companion:motion", "rest");
	}

	private startDrop(): void {
		if (!this.window || this.reducedMotion) return;
		const bounds = this.window.getBounds();
		const area = screen.getDisplayMatching(bounds).workArea;
		const distance = Math.min(
			48,
			area.y + area.height - bounds.y - bounds.height,
		);
		if (distance < 1) return;
		const drop = { timer: null as ReturnType<typeof setTimeout> | null };
		this.drop = drop;
		const started = Date.now();
		let landed = false;
		this.window.webContents.send("companion:motion", "falling");
		const frame = () => {
			if (this.drop !== drop || !this.window) return;
			const elapsed = Math.max(0, Date.now() - started);
			if (elapsed >= 260 && !landed) {
				landed = true;
				this.window.webContents.send("companion:motion", "landing");
			}
			const fall = distance * Math.min(1, (elapsed / 260) ** 2);
			const bounce =
				elapsed >= 260 && elapsed < 400
					? Math.min(5, distance) * Math.sin(((elapsed - 260) / 140) * Math.PI)
					: 0;
			this.move({ x: bounds.x, y: Math.round(bounds.y + fall - bounce) });
			if (elapsed >= 780) {
				this.cancelDrop();
				return;
			}
			const boundary = elapsed < 260 ? 260 : elapsed < 400 ? 400 : 780;
			drop.timer = setTimeout(
				frame,
				elapsed < 400 ? Math.min(16, boundary - elapsed) : boundary - elapsed,
			);
		};
		drop.timer = setTimeout(frame, 16);
	}

	private finishDrag(): void {
		const drag = this.dragOrigin;
		this.dragOrigin = null;
		if (!drag) return;
		if (this.chatOpen) this.layoutChat(true);
	}

	play(activity: CompanionActivity): void {
		if (
			!this.enabled ||
			this.disposed ||
			!this.window ||
			this.chatOpen ||
			(this.state.mood !== "idle" && this.state.mood !== "complete")
		)
			return;
		this.cancelDrop();
		this.finishDrag();
		this.window.webContents.send("companion:play", activity);
	}

	private showMenu(): void {
		this.cancelDrop();
		this.finishDrag();
		if (!this.window || this.options.headless) return;
		Menu.buildFromTemplate([
			{ label: "Chat", click: () => this.showChat() },
			{
				label: this.state.taskTitle
					? `Open task: ${this.state.taskTitle}`
					: "Open task in app",
				enabled: !!this.state.sessionId,
				click: () => this.options.openChat(this.state.sessionId),
			},
			{
				label: "Character",
				submenu: this.characterMenu,
			},
			{
				label: "Play",
				enabled:
					!this.chatOpen &&
					(this.state.mood === "idle" || this.state.mood === "complete"),
				submenu: [
					{ label: "Offer a treat", click: () => this.play("snack") },
					{ label: "Keep it up", click: () => this.play("bounce") },
					{ label: "Guess which hand", click: () => this.play("guess") },
				],
			},
			{ type: "separator" },
			{ label: "Hide companion", click: () => this.setEnabled(false) },
		]).popup({ window: this.window });
	}

	private onAction(event: IpcMainEvent, action: unknown, value: unknown): void {
		if (!this.trusted(event) || !this.window) return;
		if (action === "hide") this.setEnabled(false);
		else if (action === "menu") this.showMenu();
		else if (action === "reduced-motion" && typeof value === "boolean") {
			this.reducedMotion = value;
			if (value) this.cancelDrop();
		} else if (
			action === "chat-size" &&
			this.chatOpen &&
			typeof value === "number" &&
			Number.isFinite(value)
		) {
			const height = Math.max(
				COMPANION_CHAT_SIZE.height,
				Math.min(360, Math.ceil(value)),
			);
			if (height === this.chatHeight) return;
			this.chatHeight = height;
			if (!this.dragOrigin) this.layoutChat(true);
		} else if (action === "open") this.showChat();
		else if (action === "open-task")
			this.options.openChat(this.state.sessionId);
		else if (action === "collapse-chat") this.layoutChat(false);
		else if (action === "expand-chat") {
			this.options.openChat(this.chat.snapshot.sessionId);
			this.layoutChat(false);
		} else if (
			action === "new-chat" &&
			this.chat.snapshot.status !== "working" &&
			this.chat.snapshot.status !== "loading"
		)
			this.chat.newChat();
		else if (
			action === "interactive" &&
			typeof value === "boolean" &&
			!this.dragOrigin
		) {
			this.window.setIgnoreMouseEvents(!value, { forward: true });
		} else if (action === "drag") {
			if (value === "start") {
				this.cancelDrop();
				const [x, y] = this.window.getPosition();
				this.dragOrigin = {
					cursor: screen.getCursorScreenPoint(),
					position: { x, y },
					moved: false,
				};
				this.window.setIgnoreMouseEvents(false);
			} else if (value === "move" && this.dragOrigin) {
				const cursor = screen.getCursorScreenPoint();
				const dx = cursor.x - this.dragOrigin.cursor.x;
				const dy = cursor.y - this.dragOrigin.cursor.y;
				if (Math.hypot(dx, dy) > COMPANION_DRAG_THRESHOLD)
					this.dragOrigin.moved = true;
				if (this.dragOrigin.moved)
					this.move({
						x: this.dragOrigin.position.x + dx,
						y: this.dragOrigin.position.y + dy,
					});
			} else if (value === "end" || value === "cancel") {
				const released = value === "end" && this.dragOrigin?.moved;
				this.save();
				this.finishDrag();
				if (released) this.startDrop();
			}
		} else if (action === "nudge" && typeof value === "string") {
			const offsets: Record<string, [number, number]> = {
				ArrowLeft: [-24, 0],
				ArrowRight: [24, 0],
				ArrowUp: [0, -24],
				ArrowDown: [0, 24],
			};
			if (!Object.prototype.hasOwnProperty.call(offsets, value)) return;
			this.cancelDrop();
			const offset = offsets[value];
			const [x, y] = this.window.getPosition();
			this.move({ x: x + offset[0], y: y + offset[1] });
			this.save();
		}
	}

	private save(): void {
		try {
			const path = this.options.preferencesPath;
			writeFileSync(`${path}.tmp`, JSON.stringify(this.preferences), {
				mode: 0o600,
			});
			renameSync(`${path}.tmp`, path);
		} catch {
			this.options.report("Companion preferences could not be saved");
		}
	}

	dispose(): void {
		this.cancelDrop();
		this.disposed = true;
		this.chat.dispose();
		this.stopPolling();
		ipcMain.removeHandler("companion:get-state");
		ipcMain.removeHandler("companion:get-appearance");
		ipcMain.removeHandler("companion:get-chat");
		ipcMain.removeHandler("companion:send");
		ipcMain.removeListener("companion:action", this.onAction);
		screen.removeListener("display-removed", this.onDisplayChanged);
		screen.removeListener("display-metrics-changed", this.onDisplayChanged);
		this.window?.destroy();
		this.window = null;
	}
}
