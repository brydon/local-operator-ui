# Companion artwork

The built-in companion illustrations are Sprout, Hoodie, and Pixel. They were
generated for this feature with the built-in Codex image generation tool on
2026-09-22, using the user's character references as visual direction. No API
key, external stock asset, or character sheet is needed at runtime. The user
references are not redistributed in the app.

The shipped files live in `src/renderer/src/assets/companions/` as `sprout.png`,
`hoodie.png`, and `pixel.png`. Each is a 1254 by 1254 PNG with transparent alpha,
copied from the generated output without postprocessing. The filenames are
stable imports; the application does not refer to machine-specific generation
paths. Generation prompts are retained below so contributors can review or
replace the artwork alongside the code.

## Expressions

`src/renderer/src/companion-art.tsx` draws eyes and mouths on each blank screen.
The expression primitives are maintained as SVG source, so a state change does
not require another image generation request or model call. The image assets
are decorative; the companion control provides the accessible state and action.

| App state | Face |
| --- | --- |
| Ready | Open eyes, small smile, occasional blink |
| Working | Focused eyes and three activity dots |
| Needs you | Open ring eyes and a small surprised mouth |
| Finished | Happy curved eyes and a smile |
| Check chat | Concerned eyebrows and a frown |
| Connecting / Status unavailable | Resting eyes |

Pointer or keyboard engagement moves the eyes slightly upward. It never changes
the reported task state. The renderer uses only the app's authoritative mood;
there are no invented reading, typing, or thinking states.

## Scoped illustration exception

The illustrations retain their intrinsic cream, olive, charcoal, and mint
pigments across themes. These are artwork colors, not text, status, controls,
or UI grounds. Surrounding UI continues to use theme roles and the contrast
contract. The face is intentionally an illustration as well; its expression is
also communicated by the adjacent readable status label.

The requested living desktop character is a scoped exception to the standard
240ms UI animation duration. Its artwork may breathe by two pixels over four
seconds, blink occasionally, and animate the working dots. The enclosing
button, focus outline, and hit area never move. The eyes' engagement response
takes 120ms. `prefers-reduced-motion: reduce` removes the loops and gaze motion
entirely, leaving all six expressions visible and static. These exceptions apply
only to `.companion-art` and its descendants.

## Generation prompts

These prompts are retained for review and replacement. Each call generated one
character, without reference-image editing or a subsequent image edit.

### Sprout

> Use case: illustration. Asset type: production transparent PNG sprite for a floating desktop companion, a single original friendly sprout robot. Square 1024x1024 canvas, TRUE TRANSPARENT ALPHA background, no backdrop, no floor, no checkerboard, no cast shadow outside character. One centered, front-facing squat rounded cream ceramic CRT robot with two little rounded feet and a green two-leaf sprout growing from the top. High-quality soft 3D clay toy rendering, subtle material texture, olive leaves, rounded bevels, warm off-white casing. Large recessed near-black rounded rectangular glass face screen. CRITICAL: face screen must be COMPLETELY BLANK: absolutely no eyes, no mouth, no graphics, no text. The app will draw animated eyes onto the blank face. Straight-on orthographic view, symmetric casing, face not tilted or angled. Entire character including leaves and feet visible with 8% clear margin. Compact welcoming silhouette; no arms needed, no props, no labels, no text, no brand logos. Pale studio lighting on the object only. This is a finished small desktop sprite, not a character sheet or mockup.

### Hoodie

> Use case: illustration. Asset type: finished transparent PNG sprite for a floating desktop companion. Square canvas, TRUE transparent alpha background, no backdrop, no floor, no checkerboard, no external shadow. One single centered full-body cute squat robot wearing an olive green hoodie with the hood up, rounded cream ceramic casing and tiny cream sneakers. Polished 3D clay toy rendering, subtle fabric texture on hoodie, a large near-black glass face screen recessed in the cream head. Straight-on symmetrical orthographic front view, arms relaxed by its sides, rounded mitt hands, hoodie has cream drawstrings and a simple pocket, no logos or text. All feet, hood and hands contained within canvas with 8% transparent margin. CRITICAL: The face screen is COMPLETELY BLANK without eyes, mouth, text or graphics; eyes will be drawn live by the app on top of the blank screen. Large simple clean face screen, soft studio lighting on subject, compact endearing friendly silhouette readable at 140 pixels tall, high-quality rendered game sprite. No props, no wires, no bag, no stand, no multiple poses.

### Pixel

> Use case: stylized-concept. Asset type: square transparent PNG sprite for a floating desktop AI companion, displayed at 150px. Create one original friendly tiny pixel-art robot operator. Full body centered, perfectly front-facing and symmetric, large square dark charcoal blank face display taking most of head, cream rounded robot shell, moss-green work cap with one amber square lamp, dark green headphones, cream short body, small green boots and relaxed short arms. Crisp intentionally chunky 16-bit pixel-art rendering with simple clusters and no blur; strong readable silhouette, warm friendly collectible game sprite. The entire face screen MUST be empty solid dark charcoal: NO eyes, NO mouth, NO expression, NO lettering. Animation will be drawn separately in code. Body should fill about 82% of canvas height with breathing room all sides. Cap/head centered around upper middle. Fully transparent alpha background, no backdrop, no floor, no shadow extending beyond body. No props, no text, no logos, no watermark. One character only.
