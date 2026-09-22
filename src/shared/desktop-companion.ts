import type { CompanionAppearance } from "./companion-skin";

export type CompanionMood =
	| "idle"
	| "working"
	| "attention"
	| "complete"
	| "error"
	| "offline";

export interface CompanionState {
	mood: CompanionMood;
	label: string;
	sessionId: string | null;
}

export const COMPANION_OFFLINE: CompanionState = {
	mood: "offline",
	label: "Connecting",
	sessionId: null,
};

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/** Read the catalogue's authoritative status, never infer work from old receipts. */
export function companionStateFromCatalogue(body: unknown): CompanionState {
	const result = record(record(body)?.result);
	const rows = result?.sessions;
	if (
		!Array.isArray(rows) ||
		(Array.isArray(result?.degraded) && result.degraded.length > 0)
	) {
		return { ...COMPANION_OFFLINE, label: "Status unavailable" };
	}
	let winner: CompanionState = {
		mood: "idle",
		label: "Ready",
		sessionId: null,
	};
	let priority = 0;
	for (const value of rows) {
		const row = record(value);
		if (!row || row.archived === true) continue;
		const id = typeof row.id === "string" && row.id.length > 0 ? row.id : null;
		const code = record(row.status)?.code;
		const unseen = record(row.attention)?.unseen === true;
		let state: CompanionState;
		let rank: number;
		if (code === "approval" || code === "answer") {
			state = { mood: "attention", label: "Needs you", sessionId: id };
			rank = 6;
		} else if (code === "busy") {
			state = { mood: "working", label: "Working", sessionId: id };
			rank = 5;
		} else if (code === "wedged" || (code === "error" && unseen)) {
			state = {
				mood: "error",
				label: "Check chat",
				sessionId: id,
			};
			rank = 4;
		} else if (code === "interrupted" && unseen) {
			state = { mood: "attention", label: "Paused", sessionId: id };
			rank = 3;
		} else if (code === "complete" && unseen) {
			state = { mood: "complete", label: "Finished", sessionId: id };
			rank = 2;
		} else if (
			typeof code !== "string" ||
			![
				"idle",
				"recent",
				"attached",
				"dormant",
				"scheduled",
				"complete",
				"error",
				"interrupted",
			].includes(code)
		) {
			state = { mood: "offline", label: "Status unavailable", sessionId: id };
			rank = 1;
		} else continue;
		if (rank > priority) {
			winner = state;
			priority = rank;
		}
	}
	return winner;
}

export interface CompanionPreferences {
	enabled: boolean;
	character: string;
	position?: { x: number; y: number };
}

export function companionPreferences(value: unknown): CompanionPreferences {
	const saved = record(value);
	const point = record(saved?.position);
	return {
		enabled: typeof saved?.enabled === "boolean" ? saved.enabled : true,
		character:
			typeof saved?.character === "string" ? saved.character : "sprout",
		...(typeof point?.x === "number" &&
		Number.isFinite(point.x) &&
		typeof point.y === "number" &&
		Number.isFinite(point.y)
			? { position: { x: Math.round(point.x), y: Math.round(point.y) } }
			: {}),
	};
}

export const COMPANION_SIZE = { width: 216, height: 220 };

export function clampCompanionPosition(
	point: { x: number; y: number },
	area: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
	return {
		x: Math.round(
			Math.max(
				area.x,
				Math.min(
					point.x,
					area.x + Math.max(0, area.width - COMPANION_SIZE.width),
				),
			),
		),
		y: Math.round(
			Math.max(
				area.y,
				Math.min(
					point.y,
					area.y + Math.max(0, area.height - COMPANION_SIZE.height),
				),
			),
		),
	};
}

export interface CompanionBridge {
	getState(): Promise<CompanionState>;
	onState(listener: (state: CompanionState) => void): () => void;
	getAppearance(): Promise<CompanionAppearance>;
	onAppearance(listener: (appearance: CompanionAppearance) => void): () => void;
	openChat(): void;
	hide(): void;
	setInteractive(interactive: boolean): void;
	drag(phase: "start" | "move" | "end" | "cancel"): void;
	nudge(direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): void;
}
