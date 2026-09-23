# Desktop companion

Click the pet to say hi; use its chat button or right-click **Chat** to talk with your
default model. Drag to move it, or use the arrow keys while it has focus. In chat,
Enter sends; Shift+Enter adds a line. Escape collapses the input; drafts survive collapsing and hiding, but not
quitting. Use **Open app** for approvals, attachments, model selection, or history.
Right-click for character choices, Hide, and Open task in app.
When a task needs attention, the alert button opens that task directly.

Brush back and forth over their head or tap a few times for a little heart reaction.
Pick them up to see them dangle and wriggle; releasing gives them a short fall and
a soft landing. All companions sleep after 90 quiet seconds, including after completed
tasks. Click or move them to wake them; passing the pointer over them lets them sleep.
They stay awake while chat is open. During peekaboo, approach to get a little peek,
then click to find them. Quiet moments bring little dances and a full curl-up at bedtime.
Morning brings a stretch, daytime brings a character-specific diversion, and late night
brings a yawn. A little extra affection can reveal a surprise. These use your local clock
and give way to chat or work. Reduced motion skips idle antics, keeps reactions still,
and disables the drop.

## Custom characters

Right-click the pet and choose **Character > Add character…**, or use
**View > Companion character > Add character…**. Select a transparent PNG, or a JSON
pack for different task states:

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
    "offline": "offline.png",
    "sleeping": "sleeping.png"
  }
}
```

Only `idle` is required; omit missing task poses to use it as the fallback. The optional
`sleeping` pose appears when the companion dozes; without it, your existing image
settles down with a small sleep mark. Waking restores the current task pose. Images must
be still PNGs, at most 2048 × 2048 pixels and 2 MiB each. Paths are relative to the
pack folder and cannot leave it. Names may contain 1–64 characters. Up to 64 custom
characters can be imported. The app copies the files. Select your custom character,
then choose **Replace artwork…** in the character menu to import an edited pack;
**Remove character** removes the app's copy without changing your source files.
Custom images react to pressing and dragging, but only built-in
characters have separate animated eyes.

The bundled Sprout, Hoodie, and Pixel artwork, including their peekaboo, play, and nap sheets and Hoodie's pickup sheet, was generated with Codex image
generation on 2026-09-22. Their colors and ambient motion are part of the artwork;
controls use the app theme. Reduced motion disables movement and blinking.
