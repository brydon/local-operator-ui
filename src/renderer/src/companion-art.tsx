import { cn } from "@shared/lib/utils";
import type { CSSProperties } from "react";
import type { CompanionMood } from "../../shared/desktop-companion";
import hoodieMotion from "./assets/companions/hoodie-motion.png";
import hoodie from "./assets/companions/hoodie.png";
import pixel from "./assets/companions/pixel.png";
import sprout from "./assets/companions/sprout.png";
import "./companion-art.css";

export type BuiltinCompanionCharacter = "sprout" | "hoodie" | "pixel";
export type CompanionReaction =
	| "rest"
	| "curious"
	| "pressed"
	| "grabbed"
	| "dragging"
	| "struggling"
	| "falling"
	| "happy"
	| "landing"
	| "dozing";

const artwork: Record<BuiltinCompanionCharacter, string> = {
	sprout,
	hoodie,
	pixel,
};

const physicalReactions = new Set<CompanionReaction>([
	"grabbed",
	"dragging",
	"struggling",
	"falling",
	"landing",
]);

interface CompanionArtProps {
	character: BuiltinCompanionCharacter;
	mood: CompanionMood;
	gaze: { x: number; y: number };
	reaction: CompanionReaction;
}

interface ExpressionProps {
	mood: CompanionMood;
	pixels: boolean;
	reaction: CompanionReaction;
}

const eyePaths = {
	offline: ["M19 30q8 8 16 0m30 0q8 8 16 0", "M19 30v4h16v-4M65 30v4h16v-4"],
	complete: [
		"M17 32q10-20 20 0m26 0q10-20 20 0",
		"M17 32v-8h5v-5h10v5h5v8m26 0v-8h5v-5h10v5h5v8",
	],
	pressed: [
		"M18 32q9-12 18 0m28 0q9-12 18 0",
		"M18 32v-5h5v-4h8v4h5v5m28 0v-5h5v-4h8v4h5v5",
	],
};
const eyeRects = {
	working: { x: 18, y: 26, width: 18, height: 10, rx: 4 },
	attention: { x: 19, y: 17, width: 16, height: 24, rx: 8 },
	curious: { x: 18, y: 12, width: 18, height: 29, rx: 8 },
	idle: { x: 19, y: 16, width: 16, height: 25, rx: 8 },
};

function Eyes({ mood, pixels, reaction }: ExpressionProps) {
	const expression = mood === "idle" ? reaction : mood;
	if (expression === "happy") {
		return (
			<>
				<rect
					className={cn("companion-art-eye-fill")}
					x="19"
					y="16"
					width="16"
					height="25"
					rx={pixels ? 0 : 8}
				/>
				<path d={pixels ? "M63 31v-6h5v-4h10v4h5v6" : "M63 31q10-17 20 0"} />
			</>
		);
	}
	if (expression === "dozing") {
		return (
			<path
				d={pixels ? "M19 31h16m30 0h16" : "M19 30q8 5 16 0m30 0q8 5 16 0"}
			/>
		);
	}
	if (expression === "grabbed" || expression === "falling") {
		return [20, 64].map((x) => (
			<g key={x}>
				<rect x={x} y="13" width="17" height="29" rx={pixels ? 0 : 8} />
				<rect
					className={cn("companion-art-eye-fill")}
					x={x + 6}
					y="24"
					width="5"
					height="10"
					rx={pixels ? 0 : 2.5}
				/>
			</g>
		));
	}
	if (expression === "struggling") {
		return (
			<path
				d={
					pixels
						? "M18 19h6v5h6v6h-6v5h-6m64-16h-6v5h-6v6h6v5h6"
						: "M19 18l13 10-13 9m62-19L68 28l13 9"
				}
			/>
		);
	}
	if (
		expression === "offline" ||
		expression === "complete" ||
		expression === "pressed" ||
		expression === "landing"
	) {
		return (
			<path
				d={
					eyePaths[expression === "landing" ? "pressed" : expression][
						pixels ? 1 : 0
					]
				}
			/>
		);
	}
	if (mood === "error") {
		return (
			<>
				<path
					d={pixels ? "M17 21h8v-4h11m28 0h11v4h8" : "M17 23l18-6m30 0 18 6"}
				/>
				<path
					className={cn("companion-art-eye-fill")}
					d="M20 29h14v7H20zm46 0h14v7H66z"
				/>
			</>
		);
	}
	const shape =
		eyeRects[
			mood === "working" || mood === "attention"
				? mood
				: reaction === "rest"
					? "idle"
					: "curious"
		];
	return [0, 46].map((offset) => (
		<rect
			key={offset}
			{...shape}
			x={shape.x + offset}
			rx={pixels ? 0 : shape.rx}
			className={cn(mood !== "attention" && "companion-art-eye-fill")}
		/>
	));
}

function Mouth({ mood, pixels, reaction }: ExpressionProps) {
	if (mood === "working") {
		return (
			<g className={cn("companion-art-progress")}>
				<rect x="38" y="52" width="5" height="5" rx={pixels ? 0 : 2.5} />
				<rect x="48" y="52" width="5" height="5" rx={pixels ? 0 : 2.5} />
				<rect x="58" y="52" width="5" height="5" rx={pixels ? 0 : 2.5} />
			</g>
		);
	}
	if (mood === "attention") {
		return <rect x="46" y="50" width="8" height="11" rx={pixels ? 0 : 4} />;
	}
	if (mood === "offline") return <path d="M44 54h12" />;
	if (mood === "error") {
		return <path d={pixels ? "M40 58v-5h20v5" : "M40 58q10-10 20 0"} />;
	}
	if (mood === "idle") {
		if (reaction === "grabbed" || reaction === "falling") {
			return <rect x="44" y="49" width="12" height="13" rx={pixels ? 0 : 6} />;
		}
		if (reaction === "struggling") {
			return (
				<path
					d={pixels ? "M37 56v-5h7v5h6v-5h6v5h7" : "M37 55q4-8 8-1t8 0 10 0"}
				/>
			);
		}
		if (reaction === "dozing") return <path d="M46 53h8" />;
		if (reaction === "pressed" || reaction === "landing") {
			return <path d={pixels ? "M42 50v5h16v-5" : "M40 49q10 10 20 0"} />;
		}
		if (reaction === "dragging") {
			return (
				<path
					className={cn("companion-art-eye-fill")}
					d={pixels ? "M37 49h26v6h-5v5H42v-5h-5z" : "M36 48q14 24 28 0Z"}
				/>
			);
		}
		if (reaction === "curious" || reaction === "happy") {
			return (
				<path d={pixels ? "M34 47v8h7v5h18v-5h7v-8" : "M34 47q16 25 32 0"} />
			);
		}
	}
	return <path d={pixels ? "M38 49v7h6v4h12v-4h6v-7" : "M38 49q12 18 24 0"} />;
}

export function CompanionArt({
	character,
	mood,
	gaze,
	reaction,
}: CompanionArtProps) {
	const pixels = character === "pixel";
	const physical = physicalReactions.has(reaction);
	const expressionMood =
		(mood === "complete" && reaction !== "rest") ||
		(mood === "offline" && physical)
			? "idle"
			: mood;
	const interacting = reaction !== "rest" && reaction !== "dozing";
	const x = interacting ? gaze.x : 0;
	const y = interacting ? gaze.y : 0;
	const tracking = {
		"--companion-art-gaze-x": `${x * 7}px`,
		"--companion-art-gaze-y": `${y * 4}px`,
		"--companion-art-tilt": `${x * 2 + 1.5}deg`,
		"--companion-art-lean": `${x * 6}deg`,
		"--companion-art-sheet":
			character === "hoodie" ? `url("${hoodieMotion}")` : undefined,
	} as CSSProperties;
	return (
		<span
			aria-hidden="true"
			className={cn("companion-art", `companion-art-${character}`)}
			data-mood={mood}
			data-expression={expressionMood}
			data-reaction={reaction}
			data-physical={physical || undefined}
			style={tracking}
		>
			<span className={cn("companion-art-pose")}>
				<span className={cn("companion-art-visual")}>
					<img
						className={cn("companion-art-body")}
						src={artwork[character]}
						alt=""
						draggable={false}
					/>
					{character === "hoodie" ? (
						<span className={cn("companion-art-sprite")} />
					) : (
						["left", "right"].map((side) => (
							<img
								key={side}
								className={cn(
									"companion-art-foot",
									`companion-art-foot-${side}`,
								)}
								src={artwork[character]}
								alt=""
								draggable={false}
							/>
						))
					)}
					<svg
						aria-hidden="true"
						className={cn("companion-art-face")}
						viewBox="0 0 100 70"
						preserveAspectRatio="none"
						focusable="false"
						shapeRendering={pixels ? "crispEdges" : "geometricPrecision"}
					>
						<g className={cn("companion-art-gaze")}>
							<g className={cn("companion-art-eyes")}>
								<Eyes
									mood={expressionMood}
									pixels={pixels}
									reaction={reaction}
								/>
							</g>
							<g className={cn("companion-art-mouth")}>
								<Mouth
									mood={expressionMood}
									pixels={pixels}
									reaction={reaction}
								/>
							</g>
						</g>
					</svg>
					<svg
						aria-hidden="true"
						className={cn("companion-art-glints")}
						viewBox="0 0 100 100"
						focusable="false"
					>
						<path d="M17 36v8m-4-4h8M83 25v6m-3-3h6" />
					</svg>
				</span>
			</span>
			<svg
				aria-hidden="true"
				className={cn("companion-art-impact")}
				viewBox="0 0 100 100"
				focusable="false"
			>
				<path d="M17 91l-5-3m13 5h-8m58 0h8m0-2 5-3M33 94h34" />
			</svg>
		</span>
	);
}
