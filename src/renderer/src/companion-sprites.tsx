import { cn } from "@shared/lib/utils";
import { type CSSProperties, useState } from "react";
import hoodieNap from "./assets/companions/hoodie-nap.png";
import hoodiePeekaboo from "./assets/companions/hoodie-peekaboo.png";
import hoodiePlay from "./assets/companions/hoodie-play.png";
import inkyNap from "./assets/companions/inky-nap.png";
import inkyPeekaboo from "./assets/companions/inky-peekaboo.png";
import inkyPlay from "./assets/companions/inky-play.png";
import pixelNap from "./assets/companions/pixel-nap.png";
import pixelPeekaboo from "./assets/companions/pixel-peekaboo.png";
import pixelPlay from "./assets/companions/pixel-play.png";
import sproutNap from "./assets/companions/sprout-nap.png";
import sproutPeekaboo from "./assets/companions/sprout-peekaboo.png";
import sproutPlay from "./assets/companions/sprout-play.png";
import type { BuiltinCompanionCharacter } from "./companion-art";
import "./companion-sprites.css";

export type CompanionSpriteAction =
	| "peekaboo"
	| "peeking"
	| "found"
	| "playful"
	| "dozing"
	| "waking";

const sheets = {
	sprout: { peekaboo: sproutPeekaboo, playful: sproutPlay, nap: sproutNap },
	hoodie: { peekaboo: hoodiePeekaboo, playful: hoodiePlay, nap: hoodieNap },
	inky: { peekaboo: inkyPeekaboo, playful: inkyPlay, nap: inkyNap },
	pixel: { peekaboo: pixelPeekaboo, playful: pixelPlay, nap: pixelNap },
};

// Register the generated rows to a shared floor without changing the source art.
const offsets = {
	inky: {
		peekaboo: [-3.1, -4.2, -4, -3.6, -3.6, -3.1, -2.9, -3.1],
		playful: [-3.6, -3.3, -3.3, -3.3, 4.1, 4.1, 3.4, 3.4],
		nap: [-4.2, -2.9, -1.3, -0.4, -0.2, -2.2, -1.1, -3.6],
	},
	sprout: {
		peekaboo: [-4.4, -4.4, -4.4, -4.4, 1.9, 1.9, 1.9, 1.9],
		playful: [-4.4, -4.4, -4.4, -4.4, 3.5, 3.5, 3.5, 3.5],
		nap: [-1.9, -1.9, -1.9, -1.9, 4.6, 4.6, 4.6, 4.6],
	},
	hoodie: {
		peekaboo: [-4, -4, -4, -4, 0, 0, 0, 0],
		playful: [-4, -4, -4, -4, 1, 1, 1, 1],
		nap: [-4, -4, -4, -4, 1.2, 1.2, 1.2, 1.2],
	},
	pixel: {
		peekaboo: [0, 0, 0, 2, 7.5, 7.5, 0, 0],
		playful: [0, 0, 0, 0, 0, 0, 0, 0],
		nap: [-1, -1, -1, 2, 3.8, 3.8, 3.8, 3.8],
	},
};

const restingRegistration = {
	inky: {
		peekaboo: "translate(-0.1%, -2.9%) scale(0.942, 0.981)",
		playful: "translate(-0.65%, 2.5%) scale(1.013, 1.096)",
		nap: "translate(-0.9%, -3.4%) scale(0.957, 0.976)",
	},
	sprout: {
		peekaboo: "translate(0.77%, 4.03%) scale(1.015, 1.076)",
		playful: "translate(-0.38%, 5.65%) scale(1.056, 1.061)",
		nap: "translate(0.98%, 6.59%) scale(1.105, 1.058)",
	},
	hoodie: {
		peekaboo: "translate(0.01%, -0.34%) scale(0.920, 1.013)",
		playful: "translate(-1.30%, -1.63%) scale(0.970, 0.983)",
		nap: "translate(0.64%, 1.03%) scale(0.932, 0.988)",
	},
	pixel: {
		peekaboo: "translate(-0.46%, 0.66%) scale(0.915, 1.013)",
		playful: "translate(0.78%, 0.51%) scale(0.920, 0.982)",
		nap: "translate(-0.05%, 3.87%) scale(0.898, 1.031)",
	},
};

export function CompanionSprite({
	character,
	action,
}: { character: BuiltinCompanionCharacter; action: CompanionSpriteAction }) {
	const [ready, setReady] = useState(false);
	const sheet =
		action === "dozing" || action === "waking"
			? "nap"
			: action === "peeking" || action === "found"
				? "peekaboo"
				: action;
	const registration = Object.fromEntries(
		offsets[character][sheet].map((y, i) => [
			`--sprite-offset-${i}`,
			i === 7
				? restingRegistration[character][sheet]
				: `translate(${sheet === "nap" && i === 4 ? (character === "hoodie" ? -3 : character === "pixel" ? -1.5 : 0) : 0}%, ${y}%)`,
		]),
	) as CSSProperties;
	return (
		<span
			className={cn("companion-sprite")}
			data-action={action}
			data-ready={ready || undefined}
			style={registration}
		>
			<span className={cn("companion-sprite-motion")}>
				<span className={cn("companion-sprite-frame")}>
					<img
						className={cn("companion-sprite-sheet")}
						src={sheets[character][sheet]}
						alt=""
						draggable={false}
						onLoad={() => setReady(true)}
					/>
				</span>
			</span>
		</span>
	);
}
