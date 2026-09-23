import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { CircleAlert, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { COMPANION_OFFLINE } from "../../shared/desktop-companion";
import type {
	CompanionBridge,
	CompanionChatView,
	CompanionMotion,
} from "../../shared/desktop-companion";
import "./assets/fonts/fonts.css";
import "./styles/index.css";
import "./companion.css";
import type { CompanionAppearance } from "../../shared/companion-skin";
import { CompanionArt } from "./companion-art";
import { CompanionChat } from "./companion-chat";
import { useCompanionInteraction } from "./companion-interaction";
import { useCompanionPlay } from "./companion-play";
import { CompanionDream, CompanionPlayArt } from "./companion-play-art";

declare global {
	interface Window {
		companion: CompanionBridge;
	}
}

function syncTheme(): void {
	try {
		const saved = JSON.parse(
			localStorage.getItem("ui-preferences-storage") ?? "null",
		);
		applyThemeToDocument(
			(saved?.state?.themeName ?? DEFAULT_THEME) as ThemeName,
		);
	} catch {
		applyThemeToDocument(DEFAULT_THEME);
	}
}
syncTheme();
window.addEventListener("storage", syncTheme);

function useCompanionValue<T>(
	initial: T,
	read: () => Promise<T>,
	subscribe: (listener: (value: T) => void) => () => void,
) {
	const [value, setValue] = useState(initial);
	useEffect(() => {
		let received = false;
		const unsubscribe = subscribe((next) => {
			received = true;
			setValue(next);
		});
		void read().then((next) => {
			if (!received && next) setValue(next);
		});
		return () => {
			received = true;
			unsubscribe();
		};
	}, [read, subscribe]);
	return value;
}

function Companion() {
	const state = useCompanionValue(
		COMPANION_OFFLINE,
		window.companion.getState,
		window.companion.onState,
	);
	const appearance = useCompanionValue<CompanionAppearance>(
		{
			id: "sprout",
			name: "Sprout",
		},
		window.companion.getAppearance,
		window.companion.onAppearance,
	);
	const chat = useCompanionValue<CompanionChatView>(
		{
			open: false,
			snapshot: {
				sessionId: null,
				title: "Companion chat",
				messages: [],
				status: "idle",
				error: null,
				canSend: true,
			},
		},
		window.companion.getChat,
		window.companion.onChat,
	);
	const play = useCompanionPlay(
		!chat.open && ["idle", "complete", "offline"].includes(state.mood),
		appearance.id,
	);
	const interaction = useCompanionInteraction(
		state.mood,
		chat.open || play.scene !== null,
	);
	const playing = play.scene !== null;
	useEffect(() => window.companion.onPlay(play.start), [play.start]);
	useEffect(() => {
		if (playing)
			document
				.querySelector<HTMLButtonElement>(".companion-character")
				?.focus({ preventScroll: true });
	}, [playing]);
	useEffect(() => {
		if (["grabbed", "dragging", "struggling"].includes(interaction.reaction))
			play.cancel();
	}, [interaction.reaction, play.cancel]);
	const character =
		appearance.id === "hoodie" || appearance.id === "pixel"
			? appearance.id
			: "sprout";
	const [motion, setMotion] = useState<CompanionMotion>("rest");
	const [chatFocused, setChatFocused] = useState(false);
	const reaction =
		motion !== "rest"
			? motion
			: (play.reaction ??
				(chat.open &&
				chatFocused &&
				(interaction.reaction === "rest" || interaction.reaction === "curious")
					? "listening"
					: interaction.reaction));
	const needsAttention =
		!!state.sessionId && (state.mood === "attention" || state.mood === "error");
	const sleeping =
		reaction === "dozing" &&
		(state.mood === "idle" || state.mood === "complete");
	const [failedArt, setFailedArt] = useState({
		id: appearance.id,
		sources: [] as string[],
	});
	const failedImages = failedArt.id === appearance.id ? failedArt.sources : [];
	const customImage = [
		sleeping ? appearance.frames?.sleeping : undefined,
		appearance.frames?.[play.scene ? "idle" : state.mood],
		appearance.frames?.idle,
	].find((source) => source && !failedImages.includes(source));
	const acknowledgment = play.scene
		? play.announcement
		: reaction === "loved"
			? `${appearance.name} sends you a heart.`
			: reaction === "starstruck"
				? `${appearance.name} lights up with delight.`
				: reaction === "happy"
					? `${appearance.name} looks happy.`
					: reaction === "found"
						? `You found ${appearance.name}.`
						: "";
	const playHint = play.scene
		? play.scene.kind === "guess"
			? "Choose the left or right hand. Click a side or use Left or Right. Escape ends play."
			: play.scene.kind === "bounce"
				? "Click or press Enter to keep the ball up. Escape ends play."
				: "Click or press Enter to offer the treat. Escape ends play."
		: undefined;
	useEffect(() => {
		const unsubscribe = window.companion.onMotion(setMotion);
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => window.companion.setReducedMotion(preference.matches);
		const focus = () =>
			setChatFocused(!!document.activeElement?.closest(".companion-chat"));
		const blur = () => setChatFocused(false);
		window.addEventListener("focus", focus);
		window.addEventListener("blur", blur);
		preference.addEventListener("change", sync);
		sync();
		return () => {
			unsubscribe();
			window.removeEventListener("focus", focus);
			window.removeEventListener("blur", blur);
			preference.removeEventListener("change", sync);
		};
	}, []);
	const wasChatOpen = useRef(false);
	useEffect(() => {
		if (wasChatOpen.current && !chat.open)
			document
				.querySelector<HTMLButtonElement>(".companion-character")
				?.focus({ preventScroll: true });
		wasChatOpen.current = chat.open;
	}, [chat.open]);
	useEffect(() => {
		const hover = (event: PointerEvent) => {
			window.companion.setInteractive(
				event.target instanceof Element &&
					!!event.target.closest("button, .companion-chat"),
			);
		};
		const leave = () => window.companion.setInteractive(false);
		document.addEventListener("pointermove", hover);
		document.addEventListener("pointerleave", leave);
		return () => {
			document.removeEventListener("pointermove", hover);
			document.removeEventListener("pointerleave", leave);
		};
	}, []);

	useEffect(() => {
		if (!chat.open) return;
		const root = document.querySelector<HTMLElement>(".companion");
		const card = document.querySelector<HTMLElement>(".companion-chat");
		const pet = document.querySelector<HTMLElement>(".companion-character");
		if (!root || !card || !pet) return;
		const measure = () => {
			const styles = getComputedStyle(root);
			window.companion.resizeChat(
				Math.ceil(
					card.getBoundingClientRect().height +
						pet.getBoundingClientRect().height +
						Number.parseFloat(styles.paddingTop) +
						Number.parseFloat(styles.paddingBottom) +
						Number.parseFloat(styles.rowGap),
				),
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(card);
		observer.observe(pet);
		measure();
		return () => observer.disconnect();
	}, [chat.open]);

	return (
		<main
			className={cn("companion")}
			data-mood={state.mood}
			data-play={play.scene?.kind}
			onFocusCapture={(event) =>
				setChatFocused(!!event.target.closest(".companion-chat"))
			}
			onBlurCapture={(event) =>
				setChatFocused(
					event.relatedTarget instanceof Element &&
						!!event.relatedTarget.closest(".companion-chat"),
				)
			}
		>
			<div className={cn("companion-pet")} data-engaged={interaction.isEngaged}>
				<button
					type="button"
					className={cn("companion-character")}
					{...interaction.handlers}
					data-reaction={reaction}
					aria-label={`${appearance.name}. ${playHint ?? `${sleeping ? "Sleeping. Click to wake." : `${state.label}. Click to pet.`} Use the chat button to talk. Drag or use arrow keys to move. Right-click for options.`}`}
					onContextMenu={(event) => {
						event.preventDefault();
						play.cancel();
						interaction.reset();
						window.companion.showMenu();
					}}
					onPointerDown={(event) => {
						if (
							event.button !== 0 ||
							event.ctrlKey ||
							event.isPrimary === false
						)
							return;
						interaction.handlers.onPointerDown(event);
						event.currentTarget.setPointerCapture(event.pointerId);
						window.companion.setReducedMotion(
							window.matchMedia("(prefers-reduced-motion: reduce)").matches,
						);
						window.companion.drag("start");
					}}
					onPointerMove={(event) => {
						interaction.handlers.onPointerMove(event);
						if (event.currentTarget.hasPointerCapture(event.pointerId))
							window.companion.drag("move");
					}}
					onPointerUp={(event) => {
						const gesture = interaction.handlers.onPointerUp(event, !playing);
						if (gesture === null) return;
						if (gesture === "tap" && play.scene) {
							const bounds = event.currentTarget.getBoundingClientRect();
							play.tap(
								event.clientX < bounds.left + bounds.width / 2
									? "left"
									: "right",
							);
						} else if (gesture === "drag") play.cancel();
						if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
						window.companion.drag("end");
						event.currentTarget.releasePointerCapture(event.pointerId);
					}}
					onPointerCancel={() => {
						play.cancel();
						interaction.handlers.onPointerCancel();
						window.companion.drag("cancel");
					}}
					onLostPointerCapture={() => {
						interaction.handlers.onLostPointerCapture();
						window.companion.drag("cancel");
					}}
					onClick={(event) => {
						if (event.detail === 0) {
							if (play.scene) play.tap();
							else interaction.tap();
						}
					}}
					onKeyDown={(event) => {
						if (event.repeat && (event.key === "Enter" || event.key === " ")) {
							event.preventDefault();
							return;
						}
						if (
							event.key === "ContextMenu" ||
							(event.shiftKey && event.key === "F10")
						) {
							event.preventDefault();
							play.cancel();
							interaction.reset();
							window.companion.showMenu();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							play.cancel();
							interaction.reset();
							if (chat.open) window.companion.collapseChat();
						}
						if (
							play.scene?.kind === "guess" &&
							(event.key === "ArrowLeft" || event.key === "ArrowRight")
						) {
							event.preventDefault();
							if (!event.repeat)
								play.tap(event.key === "ArrowLeft" ? "left" : "right");
							return;
						}
						if (
							event.key === "ArrowLeft" ||
							event.key === "ArrowRight" ||
							event.key === "ArrowUp" ||
							event.key === "ArrowDown"
						) {
							event.preventDefault();
							play.cancel();
							interaction.wake();
							window.companion.nudge(event.key);
						}
					}}
				>
					{customImage ? (
						<>
							<img
								className={cn(
									"companion-custom-art",
									appearance.pixelated && "companion-custom-pixel",
									sleeping && "companion-custom-sleeping",
								)}
								src={customImage}
								onError={() =>
									setFailedArt((failed) => ({
										id: appearance.id,
										sources: [
											...(failed.id === appearance.id ? failed.sources : []),
											customImage,
										],
									}))
								}
								alt=""
								draggable={false}
							/>
							{sleeping && customImage !== appearance.frames?.sleeping && (
								<svg
									className={cn("companion-custom-sleep")}
									viewBox="0 0 26 30"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M2 17h8l-8 8h8m4-21h9l-9 9h9" />
								</svg>
							)}
						</>
					) : (
						<CompanionArt
							character={character}
							mood={play.scene ? "idle" : state.mood}
							gaze={interaction.gaze}
							reaction={reaction}
						/>
					)}
					{play.scene && (
						<CompanionPlayArt scene={play.scene} character={character} />
					)}
					{sleeping && !customImage && <CompanionDream character={character} />}
				</button>
				{needsAttention && (
					<Button
						type="button"
						variant="secondary"
						size="icon-sm"
						className={cn("companion-task-toggle rounded-full")}
						aria-label={
							state.mood === "error"
								? `Review task error${state.taskTitle ? `: ${state.taskTitle}` : ""}`
								: `Review task request${state.taskTitle ? `: ${state.taskTitle}` : ""}`
						}
						title={
							state.taskTitle
								? `${state.label}: ${state.taskTitle}`
								: state.label
						}
						onClick={() => window.companion.openTask()}
					>
						<CircleAlert aria-hidden="true" />
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					size="icon-sm"
					className={cn("companion-chat-toggle rounded-full")}
					hidden={chat.open}
					aria-label={`Chat with ${appearance.name}`}
					title="Chat"
					onClick={() => window.companion.openChat()}
				>
					<MessageCircle aria-hidden="true" />
				</Button>
			</div>
			<output className={cn("sr-only")} aria-live="polite">
				{acknowledgment}
			</output>
			<CompanionChat
				snapshot={chat.snapshot}
				open={chat.open}
				onSend={(text) => window.companion.sendMessage(text)}
				onNewChat={() => window.companion.newChat()}
				onCollapse={() => window.companion.collapseChat()}
				onExpand={() => window.companion.expandChat()}
			/>
		</main>
	);
}

const container = document.getElementById("companion");
if (container) createRoot(container).render(<Companion />);
