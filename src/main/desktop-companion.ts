import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { BrowserWindow, ipcMain, screen } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BUILTIN_COMPANIONS } from "../shared/companion-skin";
import type { CompanionAppearance } from "../shared/companion-skin";
import {
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
import { CompanionSkinLibrary } from "./companion-skins";
import { presentWindow } from "./window-raise";

interface CompanionOptions {
	url: string;
	preload: string;
	preferencesPath: string;
	skinsDirectory: string;
	headless: boolean;
	readCatalogue(): Promise<{ status: number; body: unknown }>;
	openChat(sessionId: string | null): void;
	visibilityChanged(enabled: boolean): void;
	appearanceChanged(): void;
	report(message: string): void;
}

/** A separate, narrowly privileged window. It observes work; it never runs an agent. */
export class DesktopCompanion {
	private window: BrowserWindow | null = null;
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
			!!this.window &&
			!this.window.isDestroyed() &&
			event.sender === this.window.webContents &&
			event.senderFrame === this.window.webContents.mainFrame &&
			event.senderFrame?.url === this.options.url
		);
	}

	setEnabled(enabled: boolean): void {
		if (this.disposed) return;
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
			this.window?.destroy();
			this.window = null;
			return;
		}
		if (this.window && !this.window.isDestroyed()) return;
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
			presentWindow(window, this.options.headless ? "never" : "inactive", {
				trigger: "companion-present",
				report: this.options.report,
			});
		});
		window.on("blur", () => {
			this.dragOrigin = null;
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
		}
		if (this.dirty) this.refresh();
	}

	private clamp(point: Electron.Point): Electron.Point {
		const area = screen.getDisplayMatching({
			...point,
			...COMPANION_SIZE,
		}).workArea;
		return clampCompanionPosition(point, area);
	}

	private move(point: Electron.Point): void {
		const position = this.clamp(point);
		this.window?.setPosition(position.x, position.y, false);
		this.preferences.position = position;
	}

	private onDisplayChanged(): void {
		if (!this.window) return;
		const [x, y] = this.window.getPosition();
		this.move({ x, y });
		this.save();
	}

	private onAction(event: IpcMainEvent, action: unknown, value: unknown): void {
		if (!this.trusted(event) || !this.window) return;
		if (action === "hide") this.setEnabled(false);
		else if (action === "open") this.options.openChat(this.state.sessionId);
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
				const clicked =
					value === "end" && this.dragOrigin && !this.dragOrigin.moved;
				this.dragOrigin = null;
				this.save();
				if (clicked) this.options.openChat(this.state.sessionId);
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
		this.generation++;
		if (this.poll) clearInterval(this.poll);
		if (this.debounce) clearTimeout(this.debounce);
		ipcMain.removeHandler("companion:get-state");
		ipcMain.removeHandler("companion:get-appearance");
		ipcMain.removeListener("companion:action", this.onAction);
		screen.removeListener("display-removed", this.onDisplayChanged);
		screen.removeListener("display-metrics-changed", this.onDisplayChanged);
		this.window?.destroy();
		this.window = null;
	}
}
