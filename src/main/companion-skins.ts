import { createHash, randomUUID } from "node:crypto";
import {
	constants,
	closeSync,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
	readdirSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { inflateSync } from "node:zlib";
import {
	BUILTIN_COMPANIONS,
	type CompanionAppearance,
} from "../shared/companion-skin";
import type { CompanionMood } from "../shared/desktop-companion";

const MOODS: readonly CompanionMood[] = [
	"idle",
	"working",
	"attention",
	"complete",
	"error",
	"offline",
];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 2048;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SAVED_BYTES = 17 * 1024 * 1024;
const MAX_PACKS = 64;
const PNG_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SAVED_NAME = /^custom-[a-f0-9]{32}\.json$/;
const PNG_EXTENSION = /\.png$/i;
const NAME_SEPARATORS = /[\s_-]+/g;
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let crc = index;
	for (let bit = 0; bit < 8; bit++) {
		crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return crc >>> 0;
});

interface StoredPack {
	version: 1;
	name: string;
	frames: Partial<Record<CompanionMood, string>>;
	pixelated: boolean;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("A companion pack must contain a JSON object.");
	}
	return value as Record<string, unknown>;
}

function inside(directory: string, path: string): boolean {
	const child = relative(directory, path);
	return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function readBounded(path: string, limit: number): Buffer {
	const fd = openSync(
		path,
		constants.O_RDONLY |
			(constants.O_NOFOLLOW ?? 0) |
			(constants.O_NONBLOCK ?? 0),
	);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > limit) {
			throw new Error(
				"A companion file is too large or is not a regular file.",
			);
		}
		const buffer = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, null);
			if (!count) break;
			length += count;
		}
		if (length > stat.size) {
			throw new Error(
				"A companion file changed while being imported. Try again.",
			);
		}
		return buffer.subarray(0, length);
	} finally {
		closeSync(fd);
	}
}

function crc32(bytes: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** Validate dimensions, chunk integrity and bounded scanlines before Chromium sees an image. */
function validatePng(bytes: Buffer): void {
	const invalid = () => new Error("Each pose must be a valid PNG image.");
	if (
		bytes.length > MAX_IMAGE_BYTES ||
		bytes.length < 45 ||
		!bytes.subarray(0, 8).equals(PNG_SIGNATURE)
	) {
		throw invalid();
	}
	let width = 0;
	let height = 0;
	let depth = 0;
	let channels = 0;
	let interlaced = false;
	let ended = false;
	const compressed: Buffer[] = [];
	for (let offset = 8; offset < bytes.length; ) {
		if (offset + 12 > bytes.length) throw invalid();
		const length = bytes.readUInt32BE(offset);
		const end = offset + 12 + length;
		if (end > bytes.length) throw invalid();
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		const payload = bytes.subarray(offset + 8, end - 4);
		if (
			crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
		) {
			throw invalid();
		}
		if (offset === 8 && type !== "IHDR") throw invalid();
		if (type === "IHDR") {
			if (offset !== 8 || length !== 13) throw invalid();
			width = payload.readUInt32BE(0);
			height = payload.readUInt32BE(4);
			depth = payload[8];
			const color = payload[9];
			const allowed: Record<number, readonly number[]> = {
				0: [1, 2, 4, 8, 16],
				2: [8, 16],
				3: [1, 2, 4, 8],
				4: [8, 16],
				6: [8, 16],
			};
			if (
				!allowed[color]?.includes(depth) ||
				payload[10] ||
				payload[11] ||
				payload[12] > 1
			) {
				throw invalid();
			}
			if (!width || !height || width > MAX_EDGE || height > MAX_EDGE) {
				throw new Error(
					"PNG poses must be between 1 and 2048 pixels on each side.",
				);
			}
			channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
				color
			];
			interlaced = payload[12] === 1;
		} else if (type === "IDAT") {
			compressed.push(payload);
		} else if (type === "IEND") {
			if (length || end !== bytes.length || !compressed.length) throw invalid();
			ended = true;
		} else if (type === "acTL") {
			throw new Error(
				"Use still PNG poses; animated PNG files are not supported.",
			);
		}
		offset = end;
	}
	if (!ended) throw invalid();
	let pixels: Buffer;
	try {
		pixels = inflateSync(Buffer.concat(compressed), {
			maxOutputLength: MAX_EDGE * MAX_EDGE * 8 + MAX_EDGE * 7,
		});
	} catch {
		throw invalid();
	}
	const passes = interlaced
		? [
				[0, 0, 8, 8],
				[4, 0, 8, 8],
				[0, 4, 4, 8],
				[2, 0, 4, 4],
				[0, 2, 2, 4],
				[1, 0, 2, 2],
				[0, 1, 1, 2],
			]
		: [[0, 0, 1, 1]];
	let cursor = 0;
	for (const [x, y, dx, dy] of passes) {
		const columns = Math.max(0, Math.ceil((width - x) / dx));
		const rows = Math.max(0, Math.ceil((height - y) / dy));
		if (!columns) continue;
		const stride = 1 + Math.ceil((columns * channels * depth) / 8);
		for (let row = 0; row < rows; row++) {
			if (cursor >= pixels.length || pixels[cursor] > 4) throw invalid();
			cursor += stride;
		}
	}
	if (cursor !== pixels.length) throw invalid();
}

function normalizePack(
	value: unknown,
	readFrame: (path: string) => Buffer,
): StoredPack {
	const pack = object(value);
	if (
		Object.keys(pack).some(
			(key) => !["version", "name", "frames", "pixelated"].includes(key),
		)
	) {
		throw new Error("This companion pack contains unsupported fields.");
	}
	if (pack.version !== 1)
		throw new Error("This companion pack version is not supported.");
	if (
		typeof pack.name !== "string" ||
		!pack.name.trim() ||
		pack.name.trim().length > 64 ||
		Array.from(pack.name).some(
			(char) =>
				char.charCodeAt(0) < 32 ||
				(char.charCodeAt(0) >= 127 && char.charCodeAt(0) < 160),
		)
	) {
		throw new Error(
			"Give the companion a name of 1 to 64 characters without control characters.",
		);
	}
	if (pack.pixelated !== undefined && typeof pack.pixelated !== "boolean") {
		throw new Error("The pixelated setting must be true or false.");
	}
	const sources = object(pack.frames);
	if (
		Object.keys(sources).some((key) => !MOODS.includes(key as CompanionMood))
	) {
		throw new Error("This companion pack contains an unknown pose name.");
	}
	if (typeof sources.idle !== "string") {
		throw new Error("A companion pack needs an idle PNG pose.");
	}
	const frames: StoredPack["frames"] = {};
	for (const mood of MOODS) {
		if (sources[mood] === undefined) continue;
		if (typeof sources[mood] !== "string")
			throw new Error("Each pose must name a PNG file.");
		const bytes = readFrame(sources[mood]);
		validatePng(bytes);
		frames[mood] = PNG_PREFIX + bytes.toString("base64");
	}
	return {
		version: 1,
		name: pack.name.trim(),
		frames,
		pixelated: pack.pixelated === true,
	};
}

function identifier(pack: StoredPack): string {
	return `custom-${createHash("sha256").update(JSON.stringify(pack)).digest("hex").slice(0, 32)}`;
}

function appearance(id: string, pack: StoredPack): CompanionAppearance {
	return {
		id,
		name: pack.name,
		frames: { ...pack.frames },
		pixelated: pack.pixelated,
	};
}

function nameFromPng(path: string): string {
	const name = Array.from(basename(path).slice(0, -4))
		.map((char) => {
			const code = char.charCodeAt(0);
			return code < 32 || (code >= 127 && code < 160) ? " " : char;
		})
		.join("")
		.replace(NAME_SEPARATORS, " ")
		.trim()
		.slice(0, 64)
		.trim();
	return name || "My companion";
}

/** Imports contain only copied image data. No pack can add code or access the backend. */
export class CompanionSkinLibrary {
	private readonly packs = new Map<string, StoredPack>();

	constructor(private readonly directory: string) {
		let names: string[];
		try {
			names = readdirSync(directory)
				.filter((name) => SAVED_NAME.test(name))
				.sort();
		} catch {
			return;
		}
		for (const name of names.slice(0, MAX_PACKS)) {
			try {
				const pack = normalizePack(
					JSON.parse(
						readBounded(join(directory, name), MAX_SAVED_BYTES).toString(
							"utf8",
						),
					),
					(source) => {
						if (
							!source.startsWith(PNG_PREFIX) ||
							source.length >
								PNG_PREFIX.length + 4 * Math.ceil(MAX_IMAGE_BYTES / 3)
						) {
							throw new Error("Invalid saved PNG pose.");
						}
						const encoded = source.slice(PNG_PREFIX.length);
						const bytes = Buffer.from(encoded, "base64");
						if (bytes.toString("base64") !== encoded)
							throw new Error("Invalid saved PNG pose.");
						return bytes;
					},
				);
				const id = identifier(pack);
				if (name !== `${id}.json`) continue;
				this.packs.set(id, pack);
			} catch {
				// A damaged custom pack must not prevent built-in companions from loading.
			}
		}
	}

	list(): Array<{ id: string; name: string }> {
		return [
			...BUILTIN_COMPANIONS.map(({ id, name }) => ({ id, name })),
			...Array.from(this.packs, ([id, pack]) => ({ id, name: pack.name })).sort(
				(a, b) => a.name.localeCompare(b.name),
			),
		];
	}

	get(id: string): CompanionAppearance | null {
		const builtin = BUILTIN_COMPANIONS.find((item) => item.id === id);
		if (builtin) return { ...builtin };
		const pack = this.packs.get(id);
		return pack ? appearance(id, pack) : null;
	}

	import(manifestPath: string): CompanionAppearance {
		let pack: StoredPack;
		try {
			const root = realpathSync(dirname(resolve(manifestPath)));
			const manifest = realpathSync(manifestPath);
			if (!inside(root, manifest))
				throw new Error("The manifest must be inside its chosen folder.");
			if (PNG_EXTENSION.test(manifestPath)) {
				pack = normalizePack(
					{
						version: 1,
						name: nameFromPng(manifestPath),
						frames: { idle: "idle.png" },
					},
					() => readBounded(manifest, MAX_IMAGE_BYTES),
				);
			} else {
				pack = normalizePack(
					JSON.parse(
						readBounded(manifest, MAX_MANIFEST_BYTES).toString("utf8"),
					),
					(source) => {
						if (
							!source ||
							isAbsolute(source) ||
							source.includes(":") ||
							source.includes("\\") ||
							source.split("/").includes("..") ||
							!PNG_EXTENSION.test(source)
						) {
							throw new Error(
								"Pose paths must be relative PNG filenames inside the pack folder.",
							);
						}
						const path = realpathSync(resolve(root, source));
						if (!inside(root, path))
							throw new Error("A pose points outside the pack folder.");
						return readBounded(path, MAX_IMAGE_BYTES);
					},
				);
			}
		} catch (error) {
			if (error instanceof SyntaxError)
				throw new Error("The companion manifest is not valid JSON.");
			if (error instanceof Error && "code" in error) {
				throw new Error(
					"Could not read the companion pack. Check that its JSON and PNG files are available.",
				);
			}
			throw error;
		}
		const id = identifier(pack);
		if (!this.packs.has(id) && this.packs.size >= MAX_PACKS) {
			throw new Error("The companion library is full (64 custom companions).");
		}
		const temp = join(this.directory, `.${randomUUID()}.tmp`);
		try {
			mkdirSync(this.directory, { recursive: true, mode: 0o700 });
			writeFileSync(temp, JSON.stringify(pack), { mode: 0o600, flag: "wx" });
			renameSync(temp, join(this.directory, `${id}.json`));
		} catch {
			throw new Error(
				"Could not save this companion to the app's companion library.",
			);
		} finally {
			try {
				unlinkSync(temp);
			} catch {
				/* Atomic rename already removed the temporary file. */
			}
		}
		this.packs.set(id, pack);
		return appearance(id, pack);
	}
}
