import { cn } from "@shared/lib/utils";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { COMPANION_OFFLINE } from "../../shared/desktop-companion";
import type {
	CompanionBridge,
	CompanionState,
} from "../../shared/desktop-companion";
import "./assets/fonts/fonts.css";
import "./styles/themes.generated.css";
import "./companion.css";
import type { CompanionAppearance } from "../../shared/companion-skin";
import { CompanionArt } from "./companion-art";

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

function Companion() {
	const [state, setState] = useState<CompanionState>(COMPANION_OFFLINE);
	const [appearance, setAppearance] = useState<CompanionAppearance>({
		id: "sprout",
		name: "Sprout",
	});
	const [engaged, setEngaged] = useState(false);
	useEffect(() => {
		let received = false;
		let appearanceReceived = false;
		let mounted = true;
		const unsubscribe = window.companion.onState((next) => {
			received = true;
			setState(next);
		});
		void window.companion.getState().then((next) => {
			if (mounted && !received && next) setState(next);
		});
		const unwatchAppearance = window.companion.onAppearance((next) => {
			appearanceReceived = true;
			setAppearance(next);
		});
		void window.companion.getAppearance().then((next) => {
			if (mounted && !appearanceReceived && next) setAppearance(next);
		});
		const hover = (event: PointerEvent) => {
			window.companion.setInteractive(
				event.target instanceof Element && !!event.target.closest("button"),
			);
		};
		const leave = () => window.companion.setInteractive(false);
		document.addEventListener("pointermove", hover);
		document.addEventListener("pointerleave", leave);
		return () => {
			mounted = false;
			unsubscribe();
			unwatchAppearance();
			document.removeEventListener("pointermove", hover);
			document.removeEventListener("pointerleave", leave);
		};
	}, []);

	return (
		<main className={cn("companion")} data-mood={state.mood}>
			<div className={cn("companion-bubble")}>
				<button
					type="button"
					className={cn("companion-status")}
					onClick={() => window.companion.openChat()}
					aria-label={`${state.label}. Open Local Operator chat`}
				>
					<span className={cn("companion-status-mark")} aria-hidden="true">
						{state.mood === "complete"
							? "✓"
							: state.mood === "attention" || state.mood === "error"
								? "!"
								: "·"}
					</span>
					<output aria-live="polite">{state.label}</output>
				</button>
				<button
					type="button"
					className={cn("companion-hide")}
					onClick={() => window.companion.hide()}
					aria-label="Hide companion. Show again from the View menu."
					title="Hide companion"
				>
					<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
						<path d="m4 4 8 8M12 4l-8 8" />
					</svg>
				</button>
			</div>
			<button
				type="button"
				className={cn("companion-character")}
				onPointerEnter={() => setEngaged(true)}
				onPointerLeave={() => setEngaged(false)}
				onFocus={() => setEngaged(true)}
				onBlur={() => setEngaged(false)}
				aria-label="Open Local Operator chat. Drag to move, or use arrow keys."
				title="Click to chat · Drag to move"
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					window.companion.drag("start");
				}}
				onPointerMove={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						window.companion.drag("move");
				}}
				onPointerUp={(event) => {
					if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
					window.companion.drag("end");
					event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onPointerCancel={() => window.companion.drag("cancel")}
				onLostPointerCapture={() => window.companion.drag("cancel")}
				onClick={(event) => {
					if (event.detail === 0) window.companion.openChat();
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") window.companion.hide();
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
						engaged={engaged}
					/>
				)}
			</button>
			<span className={cn("companion-hint")} aria-hidden="true">
				Click to chat · Drag to move
			</span>
		</main>
	);
}

const container = document.getElementById("companion");
if (container) createRoot(container).render(<Companion />);
