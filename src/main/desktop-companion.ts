import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { BrowserWindow, Menu, ipcMain, screen } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BUILTIN_COMPANIONS } from "../shared/companion-skin";
import type { CompanionAppearance } from "../shared/companion-skin";
import {
	COMPANION_CHAT_SIZE,
	COMPANION_OFFLINE,
	COMPANION_SIZE,
	clampCompanionPosition,
	companionPreferences,
	companionStateFromCatalogue,
} from "../shared/desktop-companion";
import type {
	CompanionPreferences,
	CompanionState,
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

/** A separate, narrowly privileged window with a text-only desktop chat client. */
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
		return (
			BUILTIN_COMPANIONS.find(
				(item) => item.id === this.preferences.character,
			) ??
			this.skins.get(this.preferences.character) ??
			BUILTIN_COMPANIONS[0]
		);
	}

	selectCharacter(id: string): void {
		if (!this.characters.some((item) => item.id === id)) return;
		this.preferences.character = id;
		this.save();
		this.options.appearanceChanged();
		if (this.window && !this.window.isDestroyed())
			this.window.webContents.send("companion:appearance", this.appearance);
	}

	importCharacter(path: string): void {
		const appearance = this.skins.import(path);
		this.selectCharacter(appearance.id);
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
			this.generation++;
			if (this.poll) clearInterval(this.poll);
			if (this.debounce) clearTimeout(this.debounce);
			this.poll = null;
			this.debounce = null;
			this.dragOrigin = null;
			this.layoutChat(false);
			this.chatOpen = false;
			this.window?.hide();
			return;
		}
		if (this.window && !this.window.isDestroyed()) {
			if (wasEnabled) return;
			presentWindow(this.window, this.options.headless ? "never" : "inactive", {
				trigger: "companion-present",
				report: this.options.report,
			});
			this.poll = setInterval(() => this.refresh(), 5000);
			this.refresh();
			return;
		}
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
			...(process.platform === "darwin" ? { type: "panel" } : {}),
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
				backgroundThrottling: false,
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
			if (!this.enabled || this.window !== window) return;
			presentWindow(window, this.options.headless ? "never" : "inactive", {
				trigger: "companion-present",
				report: this.options.report,
			});
		});
		window.on("blur", () => {
			const dragging = this.dragOrigin !== null;
			this.dragOrigin = null;
			if (dragging && this.chatOpen) this.layoutChat(true);
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
		this.poll = setInterval(() => this.refresh(), 5000);
		this.refresh();
	}

	/** Debounce fleet events and serialize reads so an old response cannot win. */
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
		if (!this.window) return;
		this.layoutChat(this.chatOpen);
	}

	private showMenu(): void {
		const dragging = this.dragOrigin !== null;
		this.dragOrigin = null;
		if (dragging && this.chatOpen) this.layoutChat(true);
		if (!this.window || this.options.headless) return;
		Menu.buildFromTemplate([
			{ label: "Chat", click: () => this.showChat() },
			{
				label: "Open task in app",
				enabled: !!this.state.sessionId,
				click: () => this.options.openChat(this.state.sessionId),
			},
			{
				label: "Character",
				submenu: this.characters.map((character) => ({
					label: character.name,
					type: "radio" as const,
					checked: character.id === this.appearance.id,
					click: () => this.selectCharacter(character.id),
				})),
			},
			{ type: "separator" },
			{ label: "Hide companion", click: () => this.setEnabled(false) },
		]).popup({ window: this.window });
	}

	private onAction(event: IpcMainEvent, action: unknown, value: unknown): void {
		if (!this.trusted(event) || !this.window) return;
		if (action === "hide") this.setEnabled(false);
		else if (action === "menu") this.showMenu();
		else if (
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
		else if (action === "expand-chat")
			this.options.openChat(this.chat.snapshot.sessionId);
		else if (
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
				if (Math.hypot(dx, dy) > 4) this.dragOrigin.moved = true;
				if (this.dragOrigin.moved)
					this.move({
						x: this.dragOrigin.position.x + dx,
						y: this.dragOrigin.position.y + dy,
					});
			} else if (value === "end" || value === "cancel") {
				const dragging = this.dragOrigin !== null;
				const clicked =
					value === "end" && this.dragOrigin && !this.dragOrigin.moved;
				this.dragOrigin = null;
				this.save();
				if (clicked) this.showChat();
				else if (dragging && this.chatOpen) this.layoutChat(true);
			}
		} else if (action === "nudge" && typeof value === "string") {
			const offsets: Record<string, [number, number]> = {
				ArrowLeft: [-24, 0],
				ArrowRight: [24, 0],
				ArrowUp: [0, -24],
				ArrowDown: [0, 24],
			};
			if (!Object.prototype.hasOwnProperty.call(offsets, value)) return;
			const offset = offsets[value];
			if (!offset) return;
			const [x, y] = this.window.getPosition();
			this.move({ x: x + offset[0], y: y + offset[1] });
			this.save();
		}
	}

	private save(): void {
		try {
			writeFileSync(
				`${this.options.preferencesPath}.tmp`,
				JSON.stringify(this.preferences),
				{ mode: 0o600 },
			);
			renameSync(
				`${this.options.preferencesPath}.tmp`,
				this.options.preferencesPath,
			);
		} catch {
			this.options.report("Companion preferences could not be saved");
		}
	}

	dispose(): void {
		this.disposed = true;
		this.chat.dispose();
		this.generation++;
		if (this.poll) clearInterval(this.poll);
		if (this.debounce) clearTimeout(this.debounce);
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
