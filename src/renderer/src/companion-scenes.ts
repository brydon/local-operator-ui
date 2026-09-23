const scenes = {
	relax: { character: "hoodie", duration: 6200 },
	balance: { character: "pixel", duration: 4800 },
	spin: { character: "sprout", duration: 3600 },
	juggle: { character: "inky", duration: 5200 },
	bubbles: { character: "inky", duration: 4000 },
	leafplay: { character: "inky", duration: 4000 },
	shell: { character: "inky", duration: 4000 },
	cuddle: { character: "inky", duration: 4000 },
};

export type CompanionScene = keyof typeof scenes;

export function getCompanionScene(character: string, action: string) {
	const scene = action in scenes ? scenes[action as CompanionScene] : undefined;
	return scene?.character === character ? scene : undefined;
}
