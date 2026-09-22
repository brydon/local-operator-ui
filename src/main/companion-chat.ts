import { randomUUID } from "node:crypto";
import {
	COMPANION_CHAT_MAX_CHARS,
	type CompanionChatMessage,
	type CompanionChatSendResult,
	type CompanionChatSnapshot,
} from "../shared/companion-chat";

interface DesktopReply {
	status: number;
	body: unknown;
}

interface CompanionChatOptions {
	requestDesktop(input: unknown): Promise<DesktopReply>;
	onChange(snapshot: CompanionChatSnapshot): void;
	cwd: string;
}

interface PendingSend {
	requestId: string;
	text: string;
	epoch: string;
	generation: number;
}

interface TurnWait {
	requestId: string;
	sawWorking: boolean;
	epoch: string;
	generation: number;
}

const SESSION_ID = /^[a-f0-9]{12}$/;
const initial = (): CompanionChatSnapshot => ({
	sessionId: null,
	title: "Companion chat",
	messages: [],
	status: "idle",
	error: null,
	canSend: true,
});

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function result(reply: DesktopReply): Record<string, unknown> {
	const body = record(reply.body);
	const value = record(body?.result);
	if (reply.status < 200 || reply.status >= 300 || !value) {
		throw new Error(
			"The request could not be confirmed. Open the app for details.",
		);
	}
	return value;
}

function message(id: unknown, value: unknown): CompanionChatMessage | null {
	const payload = record(value);
	if (
		typeof id !== "string" ||
		!id ||
		!payload ||
		(payload.kind !== undefined && payload.kind !== "message") ||
		(payload.role !== "user" && payload.role !== "assistant") ||
		!Array.isArray(payload.content)
	)
		return null;
	const text = payload.content
		.map((value) => {
			const block = record(value);
			return block &&
				(block.type === undefined || block.type === "text") &&
				!block.attachment &&
				!block.data &&
				typeof block.text === "string"
				? block.text
				: "";
		})
		.join("");
	if (!text.trim() || text.startsWith("Harness recovery notice:")) return null;
	return {
		id,
		role: payload.role,
		text:
			text.length > 24_000
				? `${text.slice(0, 24_000)}\n\n[Open the app for the full message.]`
				: text,
	};
}

/** Only durable prose and complete message events leave main; no reasoning/tool payloads. */
function transcript(
	history: unknown[],
	liveEvents: unknown[],
): CompanionChatMessage[] {
	const messages = new Map<string, CompanionChatMessage>();
	for (const value of history) {
		const entry = record(value);
		const row =
			entry?.type === "message" ? message(entry.id, entry.payload) : null;
		if (row) messages.set(row.id, row);
	}
	for (const value of liveEvents) {
		const event = record(value);
		const payload = record(event?.message);
		if (
			event?.type !== "message_end" &&
			!(event?.type === "message_start" && payload?.role === "user")
		)
			continue;
		const row = message(payload?.id, payload);
		if (row && !messages.has(row.id)) messages.set(row.id, row);
	}
	return Array.from(messages.values()).slice(-60);
}

/** A small chat client over the same authenticated desktop protocol as the main window. */
export class CompanionChatService {
	private state = initial();
	private generation = 0;
	private readId = 0;
	private disposed = false;
	private sending: number | null = null;
	private refreshing: Promise<void> | null = null;
	private createRequestId = randomUUID();
	private pending: PendingSend | null = null;
	private waiting: TurnWait | null = null;
	private remoteTurn = { epoch: "", generation: 0 };

	constructor(private readonly options: CompanionChatOptions) {}

	get snapshot(): CompanionChatSnapshot {
		return {
			...this.state,
			messages: this.state.messages.map((row) => ({ ...row })),
		};
	}

	private current(generation: number): boolean {
		return !this.disposed && generation === this.generation;
	}

	private update(changes: Partial<CompanionChatSnapshot>): void {
		if (this.disposed) return;
		this.state = { ...this.state, ...changes };
		this.options.onChange(this.snapshot);
	}

	newChat(): void {
		if (this.disposed) return;
		this.generation++;
		this.readId++;
		this.sending = null;
		this.refreshing = null;
		this.pending = null;
		this.waiting = null;
		this.remoteTurn = { epoch: "", generation: 0 };
		this.createRequestId = randomUUID();
		this.update(initial());
	}

	async open(sessionId?: string | null): Promise<void> {
		if (this.disposed) return;
		if (sessionId && !SESSION_ID.test(sessionId)) {
			this.update({
				error: "This conversation is unavailable.",
				status: "error",
				canSend: false,
			});
			return;
		}
		if (sessionId && sessionId !== this.state.sessionId) {
			this.newChat();
			this.update({ sessionId, status: "loading", canSend: false });
		}
		await this.refresh();
	}

	private async read(generation: number): Promise<boolean> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return false;
		const readId = ++this.readId;
		let reply: DesktopReply;
		try {
			reply = await this.options.requestDesktop({
				op: "sessions.get",
				sessionId,
			});
		} catch (error) {
			if (!this.current(generation) || readId !== this.readId) return false;
			throw error;
		}
		if (!this.current(generation) || readId !== this.readId) return false;
		const frame = result(reply);
		const payload = record(frame.payload);
		const frontend = record(record(payload?.frontend)?.snapshot);
		const history = record(payload?.history)?.entries;
		if (
			frame.session_id !== sessionId ||
			frontend?.session_id !== sessionId ||
			typeof frontend.streaming !== "boolean" ||
			!Array.isArray(history)
		) {
			throw new Error(
				"Conversation status is unavailable. Open the app to continue.",
			);
		}
		const liveEvents = Array.isArray(frontend.live_events)
			? frontend.live_events
			: [];
		const messages = transcript(history, liveEvents);
		const gate =
			frontend.pending_gate !== null && frontend.pending_gate !== undefined;
		const unavailable =
			payload?.cold_reason === "owner-silent" ||
			payload?.cold_reason === "owner-leaving";
		const failed = frontend.last_turn_outcome === "error";
		this.remoteTurn = {
			epoch: typeof frontend.epoch === "string" ? frontend.epoch : "",
			generation:
				typeof frontend.generation === "number" ? frontend.generation : 0,
		};
		let working = frontend.streaming;
		if (this.waiting) {
			this.waiting.sawWorking ||= working;
			const position = messages.findIndex(
				(row) => row.id === this.waiting?.requestId && row.role === "user",
			);
			const answered =
				position >= 0 &&
				messages.slice(position + 1).some((row) => row.role === "assistant");
			const settled =
				(this.remoteTurn.epoch === this.waiting.epoch
					? this.remoteTurn.generation > this.waiting.generation
					: position >= 0) &&
				["completed", "aborted", "error"].includes(
					String(frontend.last_turn_outcome),
				);
			if (!working && (this.waiting.sawWorking || answered || gate || settled))
				this.waiting = null;
			else working = true;
		}
		this.update({
			title:
				typeof frontend.conversation_title === "string" &&
				frontend.conversation_title.trim()
					? frontend.conversation_title.slice(0, 160)
					: "Companion chat",
			messages,
			status: unavailable
				? "error"
				: gate
					? "attention"
					: working
						? "working"
						: failed
							? "error"
							: "idle",
			error: unavailable
				? "This conversation is reconnecting. Open the app to continue."
				: gate
					? "Open the app to answer the pending question or approval."
					: failed
						? "The last turn stopped with an error. Open the app for details."
						: this.pending
							? "The earlier send is unconfirmed. Retry its original text to check safely."
							: null,
			canSend: !unavailable && !gate && !working && this.sending !== generation,
		});
		return !unavailable && !gate && !working;
	}

	refresh(): Promise<void> {
		if (
			this.disposed ||
			!this.state.sessionId ||
			this.sending === this.generation
		)
			return Promise.resolve();
		if (this.refreshing) return this.refreshing;
		const generation = this.generation;
		const task = this.read(generation)
			.then(() => {})
			.catch(() => {
				if (this.current(generation))
					this.update({
						status: "error",
						canSend: false,
						error:
							"Could not refresh this conversation. Open the app or wait for reconnection.",
					});
			})
			.finally(() => {
				if (this.refreshing === task) this.refreshing = null;
			});
		this.refreshing = task;
		return task;
	}

	async send(text: string): Promise<CompanionChatSendResult> {
		const outcome = (accepted: boolean): CompanionChatSendResult => ({
			accepted,
			snapshot: this.snapshot,
		});
		if (
			this.disposed ||
			this.sending === this.generation ||
			!this.state.canSend
		)
			return outcome(false);
		if (
			typeof text !== "string" ||
			!text.trim() ||
			text.length > COMPANION_CHAT_MAX_CHARS
		) {
			this.update({ error: "Write a message of 1 to 16,000 characters." });
			return outcome(false);
		}
		if (this.pending && this.pending.text !== text) {
			this.update({
				status: "error",
				error:
					"The earlier send may have arrived. Retry its original text or open the app before sending something different.",
			});
			return outcome(false);
		}
		const generation = this.generation;
		this.sending = generation;
		this.readId++;
		this.update({ status: "loading", error: null, canSend: false });
		let attempted = false;
		let accepted = false;
		let refused = false;
		try {
			if (!this.state.sessionId) {
				const created = result(
					await this.options.requestDesktop({
						op: "sessions.create",
						requestId: this.createRequestId,
						cwd: this.options.cwd,
					}),
				);
				if (!this.current(generation)) return outcome(false);
				if (
					typeof created.session_id !== "string" ||
					!SESSION_ID.test(created.session_id)
				)
					throw new Error("Chat could not start.");
				this.update({ sessionId: created.session_id });
			}
			const allowed = await this.read(generation);
			if (!this.current(generation)) return outcome(false);
			if (!allowed) return outcome(false);
			const intent = this.pending ?? {
				text,
				requestId: randomUUID(),
				...this.remoteTurn,
			};
			this.pending = intent;
			attempted = true;
			const reply = await this.options.requestDesktop({
				op: "sessions.message",
				sessionId: this.state.sessionId,
				requestId: intent.requestId,
				text: intent.text,
				mode: "prompt",
			});
			if (!this.current(generation)) return outcome(false);
			if (reply.status === 413 || reply.status === 422) {
				this.pending = null;
				refused = true;
			}
			const admitted = result(reply);
			if (
				admitted.status !== "admitted" ||
				admitted.command_id !== intent.requestId
			)
				throw new Error("No admission receipt.");
			accepted = true;
			this.pending = null;
			this.waiting = {
				requestId: intent.requestId,
				sawWorking: false,
				epoch: intent.epoch,
				generation: intent.generation,
			};
			this.update({ status: "working", error: null, canSend: false });
		} catch {
			if (this.current(generation))
				this.update({
					status: "error",
					canSend: true,
					error: refused
						? "The message was not sent. Edit it or open the app for details."
						: attempted
							? "Could not confirm the send. Retry the same message safely, or open the app to check."
							: "Chat could not start. Your message is still here; try again or open the app.",
				});
		} finally {
			if (this.current(generation)) {
				this.sending = null;
				if (this.state.status === "idle") this.update({ canSend: true });
			}
		}
		if (accepted && this.current(generation)) await this.refresh();
		return outcome(accepted && this.current(generation));
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
		this.readId++;
		this.pending = null;
		this.waiting = null;
	}
}
