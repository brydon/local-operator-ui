import { cn } from "@shared/lib/utils";
import { type CSSProperties, useState } from "react";
import hoodieNap from "./assets/companions/hoodie-nap.png";
import hoodiePeekaboo from "./assets/companions/hoodie-peekaboo.png";
import hoodiePlay from "./assets/companions/hoodie-play.png";
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
	| "playful"
	| "dozing"
	| "waking";

const sheets = {
	sprout: { peekaboo: sproutPeekaboo, playful: sproutPlay, nap: sproutNap },
	hoodie: { peekaboo: hoodiePeekaboo, playful: hoodiePlay, nap: hoodieNap },
	pixel: { peekaboo: pixelPeekaboo, playful: pixelPlay, nap: pixelNap },
};

// Register the generated rows to a shared floor without changing the source art.
const offsets = {
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

export function CompanionSprite({
	character,
	action,
}: { character: BuiltinCompanionCharacter; action: CompanionSpriteAction }) {
	const [ready, setReady] = useState(false);
	const sheet = action === "dozing" || action === "waking" ? "nap" : action;
	const registration = Object.fromEntries(
		offsets[character][sheet].map((y, i) => [
			`--sprite-offset-${i}`,
			`translate(${sheet === "nap" && i === 4 ? (character === "hoodie" ? -3 : character === "pixel" ? -1.5 : 0) : 0}%, ${y}%)`,
		]),
	) as CSSProperties;
	return (
		<span
			className={cn("companion-sprite")}
			data-action={action}
			data-ready={ready || undefined}
			style={registration}
		>
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
	);
}
