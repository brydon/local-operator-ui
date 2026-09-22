export const COMPANION_CHAT_MAX_CHARS = 16_000;

export interface CompanionChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
}

export interface CompanionChatSnapshot {
	sessionId: string | null;
	title: string;
	messages: CompanionChatMessage[];
	status: "idle" | "loading" | "working" | "attention" | "error";
	error: string | null;
	canSend: boolean;
}

export interface CompanionChatSendResult {
	accepted: boolean;
	snapshot: CompanionChatSnapshot;
}
