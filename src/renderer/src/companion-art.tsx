import { cn } from "@shared/lib/utils";
import { type CSSProperties, useEffect, useRef, useState } from "react";
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
	| "loved"
	| "waking"
	| "listening"
	| "landing"
	| "dozing"
	| "stretching"
	| "yawning"
	| "daydream"
	| "starstruck";

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

const faceBeats = [
	{
		eyes: [1, 0.95],
		brows: [0, 0],
		glance: [0, 0],
		smile: [18, 0],
		duration: 2700,
	},
	{
		eyes: [1.12, 0.6],
		brows: [-3, 2],
		glance: [-4, -2],
		smile: [10, 0],
		duration: 3100,
	},
	{
		eyes: [0.62, 0.68],
		brows: [-2, -2],
		glance: [1, -1],
		smile: [26, 15],
		duration: 2800,
	},
	{
		eyes: [0.5, 1.08],
		brows: [2, -3],
		glance: [4, 1],
		smile: [14, 3],
		duration: 2500,
	},
	{
		eyes: [0.8, 0.85],
		brows: [0, -1],
		glance: [0, 0],
		smile: [22, 0],
		duration: 3400,
	},
];

function useFaceAnimation(
	enabled: boolean,
	character: BuiltinCompanionCharacter,
) {
	const seed = character === "sprout" ? 0 : character === "hoodie" ? 2 : 3;
	const [index, setIndex] = useState(seed);
	const [paused, setPaused] = useState(false);
	useEffect(() => {
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let timer: number | undefined;
		let cursor = seed;
		const schedule = () => {
			timer = window.setTimeout(() => {
				cursor = (cursor + 1) % faceBeats.length;
				setIndex(cursor);
				schedule();
			}, faceBeats[cursor].duration);
		};
		const refresh = () => {
			window.clearTimeout(timer);
			const stopped = document.hidden || motion.matches;
			setPaused(stopped);
			cursor = seed;
			setIndex(seed);
			if (enabled && !stopped) schedule();
		};
		refresh();
		document.addEventListener("visibilitychange", refresh);
		motion.addEventListener("change", refresh);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", refresh);
			motion.removeEventListener("change", refresh);
		};
	}, [enabled, seed]);
	return { beat: faceBeats[index], index, paused };
}

function LivelyFace({
	beat,
	pixels,
	reaction,
}: {
	beat: (typeof faceBeats)[number];
	pixels: boolean;
	reaction: CompanionReaction;
}) {
	const glance = reaction === "rest" ? 1 : 0.3;
	const perk = reaction === "curious" ? 1.1 : 1;
	const lowerLip = 49 + Math.round(beat.smile[0] / 2);
	const upperLip = 49 + Math.round((beat.smile[0] - beat.smile[1]) / 2);
	const mouth = pixels
		? `M35 49V${lowerLip}H41V${lowerLip + 2}H59V${lowerLip}H65V49V${upperLip}H59V${upperLip + 2}H41V${upperLip}H35V49Z`
		: `M35 49Q50 ${49 + beat.smile[0]} 65 49Q50 ${49 + beat.smile[0] - beat.smile[1]} 35 49Z`;
	const style = {
		"--face-look-x": `${beat.glance[0] * glance}px`,
		"--face-look-y": `${beat.glance[1] * glance}px`,
		"--face-left-open": beat.eyes[0] * perk,
		"--face-right-open": beat.eyes[1] * perk,
		"--face-left-brow": `${beat.brows[0]}px`,
		"--face-right-brow": `${beat.brows[1]}px`,
	} as CSSProperties;
	return (
		<g className={cn("companion-art-live-face")} style={style}>
			<g className={cn("companion-art-live-brows")}>
				<path
					className={cn("companion-art-brow-left")}
					d={pixels ? "M17 8h8V5h11" : "M17 9q9-6 19-1"}
				/>
				<path
					className={cn("companion-art-brow-right")}
					d={pixels ? "M64 5h11v3h8" : "M64 8q10-5 19 1"}
				/>
			</g>
			<g className={cn("companion-art-eyes")}>
				<g className={cn("companion-art-eye-left")}>
					<rect
						className={cn("companion-art-eye-fill")}
						x="18"
						y="15"
						width="19"
						height="27"
						rx={pixels ? 0 : 9.5}
					/>
				</g>
				<g className={cn("companion-art-eye-right")}>
					<rect
						className={cn("companion-art-eye-fill")}
						x="63"
						y="15"
						width="19"
						height="27"
						rx={pixels ? 0 : 9.5}
					/>
				</g>
			</g>
			<path
				className={cn("companion-art-live-mouth")}
				d={mouth}
				style={{ d: `path("${mouth}")` } as CSSProperties}
			/>
		</g>
	);
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
	waking: { x: 19, y: 25, width: 16, height: 12, rx: 6 },
};

function Eyes({ mood, pixels, reaction }: ExpressionProps) {
	const expression = mood === "idle" ? reaction : mood;
	if (expression === "starstruck")
		return (
			<path
				className={cn("companion-art-eye-fill")}
				d="M27 9l4 9 10 1-7 7 2 11-9-5-9 5 2-11-7-7 10-1Zm46 0 4 9 10 1-7 7 2 11-9-5-9 5 2-11-7-7 10-1Z"
			/>
		);
	if (expression === "loved")
		return (
			<>
				<path d={eyePaths.complete[pixels ? 1 : 0]} />
				<path className={cn("companion-art-cheeks")} d="M17 44h7m52 0h7" />
			</>
		);
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
				d={
					pixels
						? "M18 29v4h18v-4m28 0v4h18v-4"
						: "M18 28q9 10 18 0m28 0q9 10 18 0"
				}
			/>
		);
	}
	if (expression === "grabbed" || expression === "falling") {
		return (
			<>
				{[18, 62].map((x) => (
					<g key={x}>
						<rect x={x} y="11" width="20" height="32" rx={pixels ? 0 : 10} />
						<rect
							className={cn("companion-art-eye-fill")}
							x={x + 7}
							y="24"
							width="6"
							height="12"
							rx={pixels ? 0 : 2.5}
						/>
					</g>
				))}
				<path
					d={pixels ? "M16 5h22m24 0h22" : "M16 5q11-6 22 0m24 0q11-6 22 0"}
				/>
			</>
		);
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
					className={cn("companion-art-task-brows")}
					d={pixels ? "M17 21h8v-4h11m28 0h11v4h8" : "M17 23l18-6m30 0 18 6"}
				/>
				<path
					className={cn("companion-art-eye-fill", "companion-art-task-eye")}
					d="M20 29h14v7H20zm46 0h14v7H66z"
				/>
			</>
		);
	}
	const shape =
		eyeRects[
			mood === "working" || mood === "attention"
				? mood
				: reaction === "waking"
					? "waking"
					: reaction === "rest" || reaction === "listening"
						? "idle"
						: "curious"
		];
	return (
		<>
			{(mood === "working" || mood === "attention") && (
				<path
					className={cn("companion-art-task-brows")}
					d={
						mood === "working"
							? "M17 17l19 4m28 0 19-4"
							: "M17 9q10-7 19 0m28 0q10-7 19 0"
					}
				/>
			)}
			{[0, 46].map((offset) => (
				<rect
					key={offset}
					{...shape}
					x={shape.x + offset}
					rx={pixels ? 0 : shape.rx}
					className={cn(
						mood !== "attention" && "companion-art-eye-fill",
						(mood === "working" || mood === "attention") &&
							"companion-art-task-eye",
					)}
				/>
			))}
		</>
	);
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
		if (reaction === "loved")
			return (
				<path
					d={
						pixels ? "M35 50v5h10v-3h10v3h10v-5" : "M35 49q8 15 15 5q7 10 15-5"
					}
				/>
			);
		if (reaction === "waking")
			return <rect x="46" y="50" width="8" height="10" rx={pixels ? 0 : 4} />;
		if (reaction === "listening")
			return <path d={pixels ? "M42 51v4h16v-4" : "M42 50q8 10 16 0"} />;
		if (reaction === "grabbed" || reaction === "falling") {
			return <rect x="43" y="48" width="14" height="17" rx={pixels ? 0 : 7} />;
		}
		if (reaction === "struggling") {
			return (
				<path
					d={pixels ? "M37 56v-5h7v5h6v-5h6v5h7" : "M37 55q4-8 8-1t8 0 10 0"}
				/>
			);
		}
		if (reaction === "dozing")
			return <rect x="47" y="50" width="6" height="5" rx={pixels ? 0 : 2.5} />;
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
		if (
			reaction === "curious" ||
			reaction === "happy" ||
			reaction === "starstruck"
		) {
			return (
				<path d={pixels ? "M34 47v8h7v5h18v-5h7v-8" : "M34 47q16 25 32 0"} />
			);
		}
	}
	return <path d={pixels ? "M38 49v7h6v4h12v-4h6v-7" : "M38 49q12 18 24 0"} />;
}

function IdleVignette({
	character,
	reaction,
	beat,
}: {
	character: BuiltinCompanionCharacter;
	reaction: CompanionReaction;
	beat: (typeof faceBeats)[number];
}) {
	const pixels = character === "pixel";
	const game = reaction === "daydream" && pixels;
	return (
		<>
			<g className={cn("companion-art-vignette-rest")}>
				<LivelyFace beat={beat} pixels={pixels} reaction="rest" />
			</g>
			<g className={cn("companion-art-vignette-scene")}>
				{game ? (
					<g className={cn("companion-art-eye-fill")}>
						<rect
							className={cn("companion-art-paddle-left")}
							x="16"
							y="16"
							width="5"
							height="18"
						/>
						<rect
							className={cn("companion-art-paddle-right")}
							x="79"
							y="35"
							width="5"
							height="18"
						/>
						<rect
							className={cn("companion-art-game-ball")}
							x="47"
							y="32"
							width="6"
							height="6"
						/>
					</g>
				) : (
					<>
						<g className={cn("companion-art-vignette-eyes")}>
							{reaction === "yawning" ? (
								<path d={eyePaths.offline[pixels ? 1 : 0]} />
							) : (
								[0, 46].map((offset) => (
									<rect
										key={offset}
										className={cn(
											"companion-art-eye-fill",
											offset === 0
												? "companion-art-peek-left"
												: "companion-art-peek-right",
										)}
										x={19 + offset}
										y="15"
										width="16"
										height="27"
										rx={pixels ? 0 : 8}
									/>
								))
							)}
						</g>
						{reaction === "yawning" ? (
							<rect
								className={cn("companion-art-yawn-mouth")}
								x="44"
								y="43"
								width="12"
								height="21"
								rx={pixels ? 0 : 6}
							/>
						) : (
							<path
								d={pixels ? "M35 48v6h8v5h14v-5h8v-6" : "M35 48q15 23 30 0"}
							/>
						)}
					</>
				)}
			</g>
		</>
	);
}

export function CompanionArt({
	character,
	mood,
	gaze,
	reaction,
}: CompanionArtProps) {
	const previousMood = useRef(mood);
	const [celebrating, setCelebrating] = useState(false);
	useEffect(() => {
		const completed =
			mood === "complete" && previousMood.current !== "complete";
		previousMood.current = mood;
		if (!completed) {
			if (mood !== "complete") setCelebrating(false);
			return;
		}
		setCelebrating(true);
		const timer = window.setTimeout(() => setCelebrating(false), 700);
		return () => window.clearTimeout(timer);
	}, [mood]);
	const pixels = character === "pixel";
	const physical = physicalReactions.has(reaction);
	const expressionMood =
		(mood === "complete" && reaction !== "rest") ||
		(mood === "offline" && physical)
			? "idle"
			: mood;
	const lively =
		(expressionMood === "idle" || expressionMood === "complete") &&
		["rest", "curious", "listening"].includes(reaction);
	const vignette =
		expressionMood === "idle" &&
		["stretching", "yawning", "daydream"].includes(reaction);
	const sleeping = expressionMood === "idle" && reaction === "dozing";
	const face = useFaceAnimation(lively, character);
	const interacting = reaction !== "rest" && reaction !== "dozing" && !vignette;
	const x = reaction === "listening" ? -0.55 : interacting ? gaze.x : 0;
	const y = reaction === "listening" ? -0.45 : interacting ? gaze.y : 0;
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
			data-vignette={vignette || undefined}
			data-sleeping={sleeping || undefined}
			data-celebrating={celebrating || undefined}
			data-face-beat={lively ? face.index : undefined}
			data-paused={face.paused || undefined}
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
					{character === "sprout" && (
						<img
							className={cn("companion-art-leaves")}
							src={sprout}
							alt=""
							draggable={false}
						/>
					)}
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
						viewBox="0 -4 100 74"
						preserveAspectRatio="none"
						focusable="false"
						shapeRendering={pixels ? "crispEdges" : "geometricPrecision"}
					>
						<g className={cn("companion-art-gaze")}>
							<g className={cn("companion-art-expression")}>
								{vignette ? (
									<IdleVignette
										character={character}
										reaction={reaction}
										beat={face.beat}
									/>
								) : lively ? (
									<LivelyFace
										beat={face.beat}
										pixels={pixels}
										reaction={reaction}
									/>
								) : (
									<>
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
									</>
								)}
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
			{vignette && reaction === "daydream" && character === "sprout" && (
				<svg
					aria-hidden="true"
					className={cn("companion-art-motes")}
					viewBox="0 0 100 100"
					focusable="false"
				>
					<circle cx="23" cy="39" r="1.5" />
					<circle cx="28" cy="34" r="1" />
					<circle cx="20" cy="30" r="1" />
				</svg>
			)}
			<svg
				aria-hidden="true"
				className={cn("companion-art-sleep-marks")}
				viewBox="0 0 100 100"
				focusable="false"
				shapeRendering={pixels ? "crispEdges" : "geometricPrecision"}
			>
				<path d="M77 35h6l-6 6h6" />
				<path className={cn("companion-art-sleep-drift")} d="M84 26h7l-7 7h7" />
			</svg>
			<svg
				aria-hidden="true"
				className={cn("companion-art-hearts")}
				viewBox="0 0 100 100"
				focusable="false"
			>
				<path d="M18 37l-4-4c-4-4 1-8 4-4c3-4 8 0 4 4Z" />
				<path d="M83 29l-3-3c-3-3 1-6 3-3c2-3 6 0 3 3Z" />
			</svg>
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
