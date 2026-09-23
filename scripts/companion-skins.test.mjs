import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/companion-skins.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { CompanionSkinLibrary } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ID = /^custom-[a-f0-9]{32}$/;
const JSON_ERROR = /not valid JSON/;
const PATH_ERROR = /relative PNG filenames/;
const ESCAPE_ERROR = /outside the pack folder/;
const MANIFEST_ESCAPE_ERROR = /manifest must be inside/;
const SIZE_ERROR = /too large/;
const DIMENSION_ERROR = /2048 pixels/;
const PNG_ERROR = /valid PNG/;
const ANIMATED_ERROR = /animated PNG/;
const SAVE_ERROR = /Could not save/;
const REGULAR_FILE_ERROR = /not a regular file/;

function chunk(type, payload) {
	const buffer = Buffer.alloc(payload.length + 12);
	buffer.writeUInt32BE(payload.length);
	buffer.write(type, 4);
	payload.copy(buffer, 8);
	buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
	return buffer;
}

function png({ width = 2, height = 2, pixels, extra = [], header = {} } = {}) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = header.depth ?? 8;
	ihdr[9] = header.color ?? 6;
	ihdr[12] = header.interlace ?? 0;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		...extra,
		chunk("IDAT", deflateSync(pixels ?? Buffer.alloc((2 * 4 + 1) * 2))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "companion-skin-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "source");
	const libraryPath = join(root, "library");
	mkdirSync(source);
	const manifest = join(source, "companion.json");
	const idle = png();
	writeFileSync(join(source, "idle.png"), idle);
	const write = (changes = {}) => {
		writeFileSync(
			manifest,
			JSON.stringify({
				version: 1,
				name: "Fern",
				frames: { idle: "idle.png" },
				...changes,
			}),
		);
		return manifest;
	};
	write();
	return {
		root,
		source,
		libraryPath,
		manifest,
		idle,
		write,
		library: new CompanionSkinLibrary(libraryPath),
	};
}

function dataUrl(bytes) {
	return `data:image/png;base64,${bytes.toString("base64")}`;
}

function savedId(pack) {
	return `custom-${createHash("sha256").update(JSON.stringify(pack)).digest("hex").slice(0, 32)}`;
}

test("import copies poses, preserves optional poses and survives removal of source files", (t) => {
	const f = fixture(t);
	const working = png({ pixels: Buffer.alloc(18, 1) });
	const sleeping = png({ pixels: Buffer.alloc(18, 2) });
	writeFileSync(join(f.source, "working.png"), working);
	writeFileSync(join(f.source, "sleeping.png"), sleeping);
	f.write({
		name: " Fern ",
		pixelated: true,
		frames: {
			idle: "idle.png",
			working: "working.png",
			sleeping: "sleeping.png",
		},
	});
	const result = f.library.import(f.manifest);
	assert.match(result.id, ID);
	assert.deepEqual(result, {
		id: result.id,
		name: "Fern",
		pixelated: true,
		frames: {
			idle: dataUrl(f.idle),
			working: dataUrl(working),
			sleeping: dataUrl(sleeping),
		},
	});
	assert.equal(f.library.import(f.manifest).id, result.id);
	assert.equal(f.library.list().length, 4);
	rmSync(f.source, { recursive: true });
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(result.id),
		result,
	);

	assert.deepEqual(readdirSync(f.libraryPath), [`${result.id}.json`]);
	if (process.platform !== "win32")
		assert.equal(
			statSync(join(f.libraryPath, `${result.id}.json`)).mode & 0o777,
			0o600,
		);
});

test("all seven poses near the image size limit survive a library restart", (t) => {
	const f = fixture(t);
	const text = Buffer.alloc(2 * 1024 * 1024 - 100, 97);
	text.write("Comment\0");
	writeFileSync(
		join(f.source, "large.png"),
		png({ extra: [chunk("tEXt", text)] }),
	);
	f.write({
		frames: Object.fromEntries(
			[
				"idle",
				"working",
				"attention",
				"complete",
				"error",
				"offline",
				"sleeping",
			].map((pose) => [pose, "large.png"]),
		),
	});
	const result = f.library.import(f.manifest);
	assert.ok(
		statSync(join(f.libraryPath, `${result.id}.json`)).size > 17 * 1024 * 1024,
	);
	assert.deepEqual(
		new CompanionSkinLibrary(f.libraryPath).get(result.id),
		result,
	);
});

test("single PNG import names the companion and persists an idle-only pose", (t) => {
	const f = fixture(t);
	for (const [filename, name] of [
		["My_little-friend.PNG", "My little friend"],
		["---__ .png", "My companion"],
		[`${"a".repeat(90)}.png`, "a".repeat(64)],
	]) {
		const image = join(f.source, filename);
		writeFileSync(image, f.idle);
		const result = f.library.import(image);
		assert.deepEqual(result, {
			id: result.id,
			name,
			pixelated: false,
			frames: { idle: dataUrl(f.idle) },
		});
		assert.deepEqual(
			new CompanionSkinLibrary(f.libraryPath).get(result.id),
			result,
		);
	}
});

test("schema requires an idle pose and rejects unsupported or mistyped fields", (t) => {
	const f = fixture(t);
	for (const bad of [
		{ version: 2 },
		{ name: " " },
		{ name: "a".repeat(65) },
		{ name: "bad\nname" },
		{ frames: {} },
		{ frames: { idle: 1 } },
		{ frames: { idle: "idle.png", sleeping: 1 } },
		{ frames: { idle: "idle.png", thinking: "idle.png" } },
		{ pixelated: "true" },
		{ script: "run.js" },
		{ frames: [] },
	]) {
		f.write(bad);
		assert.throws(() => f.library.import(f.manifest));
	}
	writeFileSync(f.manifest, "{ broken");
	assert.throws(() => f.library.import(f.manifest), JSON_ERROR);
	assert.equal(f.library.list().length, 3);
});

test("poses cannot escape the selected folder or fetch a URL", (t) => {
	const f = fixture(t);
	for (const path of [
		"../idle.png",
		"sub/../idle.png",
		"/tmp/idle.png",
		"C:\\idle.png",
		"sub\\idle.png",
		"https://example.com/idle.png",
		"file:///tmp/idle.png",
		"data:image/png;base64,anything",
		"idle.svg",
	]) {
		for (const pose of ["idle", "sleeping"]) {
			f.write({ frames: { idle: "idle.png", [pose]: path } });
			assert.throws(() => f.library.import(f.manifest), PATH_ERROR);
		}
	}
	writeFileSync(join(f.root, "outside.png"), f.idle);
	symlinkSync(join(f.root, "outside.png"), join(f.source, "escape.png"));
	for (const pose of ["idle", "sleeping"]) {
		f.write({ frames: { idle: "idle.png", [pose]: "escape.png" } });
		assert.throws(() => f.library.import(f.manifest), ESCAPE_ERROR);
	}
	mkdirSync(join(f.source, "nested"));
	symlinkSync(
		join(f.source, "idle.png"),
		join(f.source, "nested", "inside.png"),
	);
	f.write({ frames: { idle: "nested/inside.png" } });
	assert.equal(f.library.import(f.manifest).frames.idle, dataUrl(f.idle));
});

test("the selected manifest cannot itself be a symlink outside its folder", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.root, "outside.json"), readFileSync(f.manifest));
	rmSync(f.manifest);
	symlinkSync(join(f.root, "outside.json"), f.manifest);
	assert.throws(() => f.library.import(f.manifest), MANIFEST_ESCAPE_ERROR);
});

test("files and image dimensions have bounded sizes", (t) => {
	const f = fixture(t);
	const image = join(f.source, "idle.png");
	for (const [bytes, error] of [
		[Buffer.alloc(2 * 1024 * 1024 + 1), SIZE_ERROR],
		[png({ width: 2049 }), DIMENSION_ERROR],
		[png({ height: 0 }), DIMENSION_ERROR],
	]) {
		writeFileSync(image, bytes);
		assert.throws(() => f.library.import(image), error);
		assert.throws(() => f.library.import(f.manifest), error);
	}
	writeFileSync(f.manifest, " ".repeat(64 * 1024 + 1));
	assert.throws(() => f.library.import(f.manifest), SIZE_ERROR);
});

test(
	"named pipes are rejected without blocking the app",
	{ skip: process.platform === "win32" },
	(t) => {
		const f = fixture(t);
		const path = join(f.source, "idle.png");
		rmSync(path);
		execFileSync("mkfifo", [path]);
		assert.throws(() => f.library.import(f.manifest), REGULAR_FILE_ERROR);
	},
);

test("PNG validation rejects wrong signatures, corrupt chunks and invalid scanlines", (t) => {
	const f = fixture(t);
	const crcBroken = Buffer.from(f.idle);
	crcBroken[crcBroken.length - 1] ^= 1;
	const badFilter = Buffer.alloc(18);
	badFilter[0] = 5;
	for (const bytes of [
		Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>", "utf8"),
		f.idle.subarray(0, 33),
		crcBroken,
		Buffer.concat([f.idle, Buffer.from("trailing")]),
		png({ pixels: Buffer.alloc(17) }),
		png({ pixels: badFilter }),
		png({ header: { color: 1 } }),
		png({ header: { depth: 7 } }),
	]) {
		writeFileSync(join(f.source, "idle.png"), bytes);
		assert.throws(() => f.library.import(f.manifest), PNG_ERROR);
	}
	writeFileSync(
		join(f.source, "idle.png"),
		png({ extra: [chunk("acTL", Buffer.alloc(8))] }),
	);
	assert.throws(() => f.library.import(f.manifest), ANIMATED_ERROR);
});

test("valid grayscale, 16-bit and interlaced PNG scanlines are accepted", (t) => {
	const f = fixture(t);
	for (const bytes of [
		png({ header: { color: 0, depth: 1 }, pixels: Buffer.alloc(4) }),
		png({ header: { color: 6, depth: 16 }, pixels: Buffer.alloc(34) }),
		png({ header: { interlace: 1 }, pixels: Buffer.alloc(19) }),
	]) {
		writeFileSync(join(f.source, "idle.png"), bytes);
		assert.ok(f.library.import(f.manifest));
	}
});

test("stored packs are validated individually and a corrupt pack cannot hide a healthy one", (t) => {
	const f = fixture(t);
	const good = f.library.import(f.manifest);
	const valid = JSON.parse(
		readFileSync(join(f.libraryPath, `${good.id}.json`), "utf8"),
	);
	for (const invalid of [
		"https://example.com/pet.png",
		"data:image/png;base64,bm90IHBuZw==",
		"data:image/png;base64,!bad",
	]) {
		for (const pose of ["idle", "sleeping"]) {
			const corrupt = {
				...valid,
				frames: { ...valid.frames, [pose]: invalid },
			};
			writeFileSync(
				join(f.libraryPath, `${savedId(corrupt)}.json`),
				JSON.stringify(corrupt),
			);
		}
	}
	writeFileSync(
		join(f.libraryPath, "custom-00000000000000000000000000000000.json"),
		"broken",
	);
	writeFileSync(
		join(f.libraryPath, "custom-11111111111111111111111111111111.json"),
		JSON.stringify({ ...valid, name: "Changed without matching its ID" }),
	);
	const loaded = new CompanionSkinLibrary(f.libraryPath);
	assert.equal(loaded.list().length, 4);
	assert.deepEqual(loaded.get(good.id), good);
});

test("stored symlinks are not followed even when they contain a valid pack", (t) => {
	const f = fixture(t);
	const good = f.library.import(f.manifest);
	const stored = join(f.libraryPath, `${good.id}.json`);
	const outside = join(f.root, "outside.json");
	writeFileSync(outside, readFileSync(stored));
	rmSync(stored);
	symlinkSync(outside, stored);
	assert.equal(new CompanionSkinLibrary(f.libraryPath).get(good.id), null);
});

test("failed persistence does not leave an imported entry in memory", (t) => {
	const f = fixture(t);
	writeFileSync(f.libraryPath, "not a directory");
	assert.throws(() => f.library.import(f.manifest), SAVE_ERROR);
	assert.equal(f.library.list().length, 3);
});
