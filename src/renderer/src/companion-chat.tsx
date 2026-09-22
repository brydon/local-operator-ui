import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { cn } from "@shared/lib/utils";
import { ArrowUp, ArrowUpRight, ChevronUp, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CompanionChatSnapshot } from "../../shared/companion-chat";
import { COMPANION_CHAT_MAX_CHARS } from "../../shared/companion-chat";
import "./companion-chat.css";

export interface CompanionChatProps {
	snapshot: CompanionChatSnapshot;
	onSend: (text: string) => Promise<boolean>;
	onNewChat: () => void;
	onCollapse: () => void;
	onExpand: () => void;
	open: boolean;
}

export function CompanionChat({
	snapshot,
	onSend,
	onNewChat,
	onCollapse,
	onExpand,
	open,
}: CompanionChatProps) {
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const composer = useRef<HTMLTextAreaElement>(null);
	const sendButton = useRef<HTMLButtonElement>(null);
	const transcript = useRef<HTMLElement>(null);
	const composing = useRef(false);
	const inFlight = useRef(false);
	const previousReply = useRef("");
	const hintId = useId();
	const errorId = useId();
	const error =
		snapshot.status === "attention" ? null : (snapshot.error ?? sendError);
	const canSend = snapshot.canSend && !sending;
	const busy =
		sending || snapshot.status === "working" || snapshot.status === "loading";
	const reply = snapshot.messages
		.filter((message) => message.role === "assistant")
		.at(-1);
	const replyKey = `${snapshot.sessionId ?? ""}:${reply?.id ?? ""}`;
	const status = sending
		? "Sending…"
		: snapshot.status === "loading"
			? "Loading…"
			: snapshot.status === "working"
				? "Working…"
				: "";

	useEffect(() => {
		if (open) composer.current?.focus({ preventScroll: true });
	}, [open]);

	useLayoutEffect(() => {
		if (previousReply.current === replyKey) return;
		previousReply.current = replyKey;
		// Each new answer starts at its beginning; rerenders never move the reader.
		if (transcript.current) transcript.current.scrollTop = 0;
	}, [replyKey]);

	useLayoutEffect(() => {
		const input = composer.current;
		if (!open || !input) return;
		input.style.height = "32px";
		input.style.height = `${Math.max(32, Math.min(64, input.scrollHeight))}px`;
	});

	async function submit() {
		const submittedDraft = draft;
		const text = submittedDraft.trim();
		if (!text || !canSend || inFlight.current) return;
		inFlight.current = true;
		setSending(true);
		setSendError(null);
		try {
			if (await onSend(text)) {
				setDraft((current) => (current === submittedDraft ? "" : current));
			} else {
				setSendError("Send could not be confirmed. Your draft is saved.");
			}
		} catch {
			setSendError("Send could not be confirmed. Your draft is saved.");
		} finally {
			inFlight.current = false;
			setSending(false);
			if (document.activeElement === sendButton.current) {
				composer.current?.focus({ preventScroll: true });
			}
		}
	}

	return (
		<section
			className={cn("companion-chat")}
			aria-label="Companion chat"
			hidden={!open}
			onKeyDown={(event) => {
				if (
					event.key === "Escape" &&
					!event.nativeEvent.isComposing &&
					!composing.current
				) {
					event.stopPropagation();
					onCollapse();
				}
			}}
		>
			{reply && (
				<section
					ref={transcript}
					className={cn("companion-chat-transcript companion-chat-reply")}
					aria-label="Latest reply"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded reply needs keyboard focus for scrolling.
					tabIndex={0}
				>
					<p aria-live="polite" aria-atomic="true">
						{reply.text}
					</p>
				</section>
			)}

			<div className={cn("companion-chat-compose-area")}>
				{snapshot.status === "attention" && (
					<div className={cn("companion-chat-attention")}>
						<output>Needs your input</output>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className={cn("companion-chat-open")}
							disabled={!snapshot.sessionId}
							onClick={onExpand}
						>
							Open app
						</Button>
					</div>
				)}
				{error && (
					<p id={errorId} role="alert" className={cn("companion-chat-error")}>
						{error}
					</p>
				)}
				{status && !error && snapshot.status !== "attention" && (
					<output className={cn("companion-chat-status")} aria-live="polite">
						{status}
					</output>
				)}
				<form
					className={cn("companion-chat-composer")}
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<Textarea
						ref={composer}
						className={cn("companion-chat-input")}
						rows={1}
						maxLength={COMPANION_CHAT_MAX_CHARS}
						readOnly={sending}
						value={draft}
						aria-label="Message Local Operator"
						aria-describedby={error ? `${hintId} ${errorId}` : hintId}
						placeholder="Ask anything…"
						onChange={(event) => {
							if (!inFlight.current) setDraft(event.target.value);
						}}
						onCompositionStart={() => {
							composing.current = true;
						}}
						onCompositionEnd={() => {
							composing.current = false;
						}}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing &&
								!composing.current &&
								event.nativeEvent.keyCode !== 229
							) {
								event.preventDefault();
								void submit();
							}
						}}
					/>
					<div className={cn("companion-chat-actions")}>
						{snapshot.sessionId && (
							<>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className={cn("companion-chat-button")}
									aria-label="New chat"
									title="New chat"
									disabled={busy}
									onClick={() => {
										setSendError(null);
										onNewChat();
										composer.current?.focus({ preventScroll: true });
									}}
								>
									<Plus size={14} aria-hidden="true" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className={cn("companion-chat-button")}
									aria-label="Open chat in the full app"
									title="Open in the full app"
									disabled={!snapshot.sessionId}
									onClick={onExpand}
								>
									<ArrowUpRight size={14} aria-hidden="true" />
								</Button>
							</>
						)}
						<Button
							ref={sendButton}
							type="submit"
							size="icon"
							variant="primary"
							className={cn("companion-chat-send")}
							aria-label="Send message"
							title="Send message"
							disabled={!canSend || !draft.trim()}
						>
							<ArrowUp size={16} aria-hidden="true" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn("companion-chat-button")}
							aria-label="Collapse chat"
							title="Collapse chat"
							onClick={onCollapse}
						>
							<ChevronUp size={14} aria-hidden="true" />
						</Button>
					</div>
				</form>
				<span id={hintId} className={cn("companion-chat-sr-only")}>
					Enter to send. Shift+Enter for a new line.
				</span>
				{draft.length >= COMPANION_CHAT_MAX_CHARS - 1000 && (
					<output className={cn("companion-chat-count")}>
						{draft.length.toLocaleString()} /{" "}
						{COMPANION_CHAT_MAX_CHARS.toLocaleString()}
					</output>
				)}
			</div>
		</section>
	);
}
