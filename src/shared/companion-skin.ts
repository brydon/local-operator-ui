import type { CompanionMood } from "./desktop-companion";

export interface CompanionAppearance {
	id: string;
	name: string;
	frames?: Partial<Record<CompanionMood, string>>;
	pixelated?: boolean;
}

export const BUILTIN_COMPANIONS = [
	{ id: "sprout", name: "Sprout" },
	{ id: "hoodie", name: "Hoodie" },
	{ id: "pixel", name: "Pixel", pixelated: true },
] as const satisfies readonly CompanionAppearance[];
