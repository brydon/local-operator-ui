import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { MessageCircle } from "lucide-react";
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
	const interaction = useCompanionInteraction(state.mood);
	const [motion, setMotion] = useState<CompanionMotion>("rest");
	const reaction = motion === "rest" ? interaction.reaction : motion;
	useEffect(() => {
		const unsubscribe = window.companion.onMotion(setMotion);
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => window.companion.setReducedMotion(preference.matches);
		preference.addEventListener("change", sync);
		document.addEventListener("visibilitychange", sync);
		sync();
		return () => {
			unsubscribe();
			preference.removeEventListener("change", sync);
			document.removeEventListener("visibilitychange", sync);
		};
	}, []);
	const lastGesture = useRef<"tap" | "drag" | null>(null);
	const firstClickWasTap = useRef(false);
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
		<main className={cn("companion")} data-mood={state.mood}>
			<div className={cn("companion-pet")} data-engaged={interaction.isEngaged}>
				<button
					type="button"
					className={cn("companion-character")}
					{...interaction.handlers}
					data-reaction={reaction}
					aria-label={`${appearance.name}. ${state.label}. Click to pet. Double-click to chat. Drag or use arrow keys to move. Right-click for options.`}
					title={`${state.label} · Click to pet · Double-click to chat`}
					onContextMenu={(event) => {
						event.preventDefault();
						interaction.reset();
						lastGesture.current = null;
						firstClickWasTap.current = false;
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
						window.companion.drag("start");
					}}
					onPointerMove={(event) => {
						interaction.handlers.onPointerMove(event);
						if (event.currentTarget.hasPointerCapture(event.pointerId))
							window.companion.drag("move");
					}}
					onPointerUp={(event) => {
						lastGesture.current = interaction.handlers.onPointerUp(event);
						if (lastGesture.current === null) return;
						if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
						window.companion.drag("end");
						event.currentTarget.releasePointerCapture(event.pointerId);
					}}
					onPointerCancel={() => {
						interaction.handlers.onPointerCancel();
						window.companion.drag("cancel");
					}}
					onLostPointerCapture={() => {
						interaction.handlers.onLostPointerCapture();
						window.companion.drag("cancel");
					}}
					onClick={(event) => {
						if (event.detail === 0) interaction.tap();
						else if (event.detail === 1)
							firstClickWasTap.current = lastGesture.current === "tap";
					}}
					onDoubleClick={() => {
						if (firstClickWasTap.current && lastGesture.current === "tap")
							window.companion.openChat();
						firstClickWasTap.current = false;
					}}
					onKeyDown={(event) => {
						if (
							event.key === "ContextMenu" ||
							(event.shiftKey && event.key === "F10")
						) {
							event.preventDefault();
							interaction.reset();
							window.companion.showMenu();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							interaction.reset();
							if (chat.open) window.companion.collapseChat();
						}
						if (
							event.key === "ArrowLeft" ||
							event.key === "ArrowRight" ||
							event.key === "ArrowUp" ||
							event.key === "ArrowDown"
						) {
							event.preventDefault();
							window.companion.nudge(event.key);
						}
					}}
				>
					{appearance.frames ? (
						<img
							className={cn(
								"companion-custom-art",
								appearance.pixelated && "companion-custom-pixel",
							)}
							src={appearance.frames[state.mood] ?? appearance.frames.idle}
							alt=""
							draggable={false}
						/>
					) : (
						<CompanionArt
							character={
								appearance.id === "hoodie" || appearance.id === "pixel"
									? appearance.id
									: "sprout"
							}
							mood={state.mood}
							gaze={interaction.gaze}
							reaction={reaction}
						/>
					)}
				</button>
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
