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
	const transcript = useRef<HTMLDivElement>(null);
	const composing = useRef(false);
	const inFlight = useRef(false);
	const followsLatest = useRef(true);
	const savedScrollTop = useRef(0);
	const previousSession = useRef(snapshot.sessionId);
	const headingId = useId();
	const hintId = useId();
	const errorId = useId();
	const error =
		snapshot.status === "attention" ? null : (snapshot.error ?? sendError);
	const canSend = snapshot.canSend && !sending;
	const busy =
		sending || snapshot.status === "working" || snapshot.status === "loading";

	useEffect(() => {
		if (open) composer.current?.focus({ preventScroll: true });
	}, [open]);

	// New messages and composer/status changes can both change the scroll range.
	useLayoutEffect(() => {
		if (previousSession.current !== snapshot.sessionId) {
			previousSession.current = snapshot.sessionId;
			followsLatest.current = true;
			savedScrollTop.current = 0;
		}
		const viewport = transcript.current;
		if (!open || !viewport) return;
		viewport.scrollTop = followsLatest.current
			? viewport.scrollHeight
			: savedScrollTop.current;
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
				// A draft edited during delivery belongs to the next message.
				setDraft((current) => (current === submittedDraft ? "" : current));
				followsLatest.current = true;
			} else {
				setSendError(
					"Delivery could not be confirmed. Your draft is saved here.",
				);
			}
		} catch {
			setSendError(
				"Delivery could not be confirmed. Your draft is saved here.",
			);
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
			aria-labelledby={headingId}
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
			<header className={cn("companion-chat-header")}>
				<h2
					id={headingId}
					className={cn("companion-chat-title")}
					title={snapshot.title || "Local Operator"}
				>
					{snapshot.title || "Local Operator"}
				</h2>
				<div className={cn("companion-chat-actions")}>
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
			</header>

			<div
				ref={transcript}
				className={cn("companion-chat-transcript")}
				onScroll={(event) => {
					if (!open) return;
					const viewport = event.currentTarget;
					savedScrollTop.current = viewport.scrollTop;
					followsLatest.current =
						viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <
						32;
				}}
			>
				{snapshot.messages.length === 0 && snapshot.status !== "loading" ? (
					<div className={cn("companion-chat-empty")}>
						<p>What can I help with?</p>
						<span>Uses your default Local Operator model.</span>
					</div>
				) : (
					<ol
						className={cn("companion-chat-messages")}
						aria-label="Chat messages"
						aria-live="polite"
						aria-relevant="additions text"
					>
						{snapshot.messages.map((message) => (
							<li
								key={message.id}
								className={cn(
									"companion-chat-message",
									message.role === "user" && "companion-chat-message-user",
								)}
							>
								<span className={cn("companion-chat-speaker")}>
									{message.role === "user" ? "You" : "Local Operator"}
								</span>
								<p>{message.text}</p>
							</li>
						))}
					</ol>
				)}
			</div>

			<div className={cn("companion-chat-compose-area")}>
				{snapshot.status === "attention" && (
					<div className={cn("companion-chat-attention")}>
						<output>Needs your input in the full app.</output>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className={cn("companion-chat-open")}
							disabled={!snapshot.sessionId}
							onClick={onExpand}
						>
							Open
						</Button>
					</div>
				)}
				{error && (
					<p id={errorId} role="alert" className={cn("companion-chat-error")}>
						{error}
					</p>
				)}
				{!error && snapshot.status !== "attention" && (
					<output className={cn("companion-chat-status")} aria-live="polite">
						{sending
							? "Sending…"
							: snapshot.status === "loading"
								? "Loading chat…"
								: snapshot.status === "working"
									? "Working…"
									: ""}
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
						rows={2}
						maxLength={COMPANION_CHAT_MAX_CHARS}
						readOnly={sending}
						value={draft}
						aria-label="Message Local Operator"
						aria-describedby={error ? `${hintId} ${errorId}` : hintId}
						placeholder="Ask me anything…"
						onChange={(event) => setDraft(event.target.value)}
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
				</form>
				<p id={hintId} className={cn("companion-chat-hint")}>
					{draft.length >= COMPANION_CHAT_MAX_CHARS - 1000
						? `${draft.length.toLocaleString()} / ${COMPANION_CHAT_MAX_CHARS.toLocaleString()} characters`
						: "Enter to send · Shift+Enter for a new line"}
				</p>
			</div>
		</section>
	);
}
