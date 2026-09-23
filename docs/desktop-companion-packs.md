# Desktop companion

Click the pet to chat using your default model. Enter sends; Shift+Enter adds a
line. Escape collapses the input; drafts survive collapsing and hiding, but not
quitting. Use **Open app** for approvals, attachments, model selection, or history.
Right-click for character choices, Hide, and Open task in app.

## Custom characters

Choose **View > Companion character > Add character…** and select a transparent
PNG, or a JSON pack for different task states:

```json
{
  "version": 1,
  "name": "My companion",
  "pixelated": false,
  "frames": {
    "idle": "idle.png",
    "working": "working.png",
    "attention": "attention.png",
    "complete": "complete.png",
    "error": "error.png",
    "offline": "offline.png"
  }
}
```

Only `idle` is required; omit missing poses to use it as the fallback. Images must
be still PNGs, at most 2048 × 2048 pixels and 2 MiB each. Paths are relative to the
pack folder and cannot leave it. Names may contain 1–64 characters. Up to 64 custom
characters can be imported. The app copies the files; import an edited pack again
to update it. Custom images react to pressing and dragging, but only built-in
characters have separate animated eyes.

The bundled Sprout, Hoodie, and Pixel PNGs were generated with Codex image
generation on 2026-09-22. Their colors and ambient motion are part of the artwork;
controls use the app theme. Reduced motion disables movement and blinking.
