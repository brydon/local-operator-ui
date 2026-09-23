import { cn } from "@shared/lib/utils";
import type { BuiltinCompanionCharacter } from "./companion-art";
import type { CompanionPlayScene } from "./companion-play";
import "./companion-play-art.css";

function Seed() {
	return (
		<>
			<path
				className={cn("companion-play-seed")}
				d="M0-6C7-3 6 5 0 7C-6 5-7-3 0-6Z"
			/>
			<path className={cn("companion-play-detail")} d="M0-3Q-2 1 0 4" />
		</>
	);
}

function Treat({
	character,
	bitten,
}: { character: BuiltinCompanionCharacter; bitten: boolean }) {
	if (character === "pixel") {
		return (
			<>
				<path
					className={cn("companion-play-biscuit")}
					d={bitten ? "M-7-6H1V-2H7V6H-7Z" : "M-7-6H7V6H-7Z"}
				/>
				<path
					className={cn("companion-play-detail")}
					d="M-4-2h1m-1 5h1m6 0h1"
				/>
			</>
		);
	}
	if (character === "sprout") return <Seed />;
	return (
		<>
			<path
				className={cn("companion-play-berry")}
				d={
					bitten
						? "M0-5C-9-9-11 6-1 8C5 10 9 4 7 0Q1 2 0-5Z"
						: "M0-5C-9-9-11 6-1 8C8 11 12-7 0-5Z"
				}
			/>
			<path
				className={cn("companion-play-leaf")}
				d="M0-5Q-2-12 6-10Q6-5 0-5Z"
			/>
			<path className={cn("companion-play-detail")} d="M-5-1l-1 3" />
		</>
	);
}

export function CompanionPlayArt({
	scene,
	character,
}: {
	scene: CompanionPlayScene;
	character: BuiltinCompanionCharacter;
}) {
	const revealed = scene.phase === "reveal" || scene.phase === "finish";
	return (
		<svg
			className={cn("companion-play-art")}
			viewBox="0 0 110 110"
			aria-hidden="true"
			focusable="false"
			data-kind={scene.kind}
			data-phase={scene.phase}
			data-character={character}
			data-step={scene.step}
		>
			{scene.kind === "snack" && scene.phase !== "finish" && (
				<g transform="translate(80 77)">
					<ellipse
						className={cn("companion-play-shadow")}
						cx="0"
						cy="12"
						rx="10"
						ry="2"
					/>
					<g className={cn("companion-play-treat")} key={scene.step}>
						<Treat character={character} bitten={scene.step > 0} />
					</g>
					{scene.phase === "playing" && (
						<g
							className={cn("companion-play-crumbs")}
							key={`crumbs-${scene.step}`}
						>
							<path d="m-12 0 2 1m18 3 2-1m-13 7 1 2" />
						</g>
					)}
				</g>
			)}
			{scene.kind === "bounce" && scene.phase !== "finish" && (
				<g className={cn("companion-play-ball")} key={scene.step}>
					<circle
						className={cn("companion-play-ball-body")}
						cx="55"
						cy="18"
						r="7"
					/>
					<path
						className={cn("companion-play-ball-seam")}
						d="M49 14q6 7 12 0M49 22q6-5 12 0"
					/>
					<path className={cn("companion-play-detail")} d="m52 13-1 1" />
				</g>
			)}
			{scene.kind === "guess" &&
				(["left", "right"] as const).map((side) => (
					<g
						key={side}
						transform={`translate(${side === "left" ? 22 : 88} 78)`}
						data-chosen={scene.choice === side || undefined}
					>
						<path className={cn("companion-play-cuff")} d="M-7 6H7L6 11H-6Z" />
						<path
							className={cn("companion-play-mitten")}
							d={
								revealed
									? "M-9 2Q-13-5-8-5L-5-1V-8Q-3-12 0-8Q3-12 5-7Q9-9 10-4L9 3Q7 8 0 8Q-7 8-9 2Z"
									: "M-9 2Q-12-3-9-5Q-6-7-5-3V-5Q-5-10 0-9Q9-10 10-4L9 3Q7 8 0 8Q-7 8-9 2Z"
							}
						/>
						{revealed && scene.side === side && <Seed />}
						{!revealed && (
							<path
								className={cn("companion-play-detail")}
								d="M-4-3q5-2 9 0M-5 1q5-2 10 0"
							/>
						)}
					</g>
				))}
			{scene.phase === "finish" && (
				<path
					className={cn("companion-play-heart")}
					d="M80 67C68 59 72 53 77 55L80 58L83 55C88 53 92 59 80 67Z"
				/>
			)}
			{scene.shiny && scene.phase === "finish" && (
				<g className={cn("companion-play-shiny")}>
					<ellipse cx="55" cy="58" rx="44" ry="40" />
					<path d="m18 19 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm74 10 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Z" />
				</g>
			)}
		</svg>
	);
}

export function CompanionDream({
	character,
}: { character: BuiltinCompanionCharacter }) {
	return (
		<svg
			className={cn("companion-dream")}
			viewBox="0 0 110 110"
			aria-hidden="true"
			focusable="false"
		>
			<circle cx="24" cy="30" r="1.5" />
			<circle cx="20" cy="24" r="2.5" />
			<path d="M10 20C-1 16 3 5 10 6C13-2 23 0 25 6C35 5 36 17 27 20Z" />
			<g transform="translate(17 11) scale(.65)">
				{character === "sprout" ? (
					<Seed />
				) : character === "hoodie" ? (
					<path
						className={cn("companion-play-dream-mark")}
						d="m0-8 2 5 6 1-5 4 1 6-4-3-5 3 1-6-4-4 6-1Z"
					/>
				) : (
					<path
						className={cn("companion-play-dream-mark")}
						d="m-7-5 5 5-5 5M1 5h6"
					/>
				)}
			</g>
		</svg>
	);
}
