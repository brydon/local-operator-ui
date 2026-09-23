import type { CompanionMood } from "./desktop-companion";

export type CompanionPose = CompanionMood | "sleeping";

export interface CompanionAppearance {
	id: string;
	name: string;
	frames?: Partial<Record<CompanionPose, string>>;
	pixelated?: boolean;
}

export const BUILTIN_COMPANIONS = [
	{ id: "sprout", name: "Sprout" },
	{ id: "hoodie", name: "Hoodie" },
	{ id: "pixel", name: "Pixel", pixelated: true },
] as const satisfies readonly CompanionAppearance[];
