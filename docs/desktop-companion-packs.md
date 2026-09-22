# Make a desktop companion

Choose a PNG for a one-look character, or a JSON manifest for multiple
expressions, from **View > Companion character > Add character…**.
The desktop companion also offers three built-in characters: Sprout, Hoodie
and Pixel. Displaying and customizing a character needs no plugin, API key or model request.

Click the character for a small input bubble. Enter sends; Shift+Enter adds a
line. Right-click (or press Shift+F10 while the pet is focused) for Hide,
character choices, and Open task in app.
Collapse the card (or press Escape inside it) to return to the small pet; your
unsent draft and conversation remain there when you reopen it. The arrow in the
input bubble opens that conversation in the full app. Open task in app in
the context menu opens the task the pet is reporting without changing the
companion’s own conversation.

A new companion conversation uses Local Operator's configured default model
and your home directory as its starting folder. Sending a message uses your
normal provider and credentials. The bubble shows only the latest completed assistant reply; tool details, long history, attachments, model
selection and approval/question controls remain in the full app. A pending
approval or question offers **Open app** and prevents further inline sends.

The panel keeps a draft if delivery cannot be confirmed. Retrying the same
text reuses its request identifier, so a lost response does not intentionally
create a second turn. A new chat starts only when you send its first message.
Drafts are kept while the card is collapsed, and hiding the companion. They are not saved across quitting the app
or closing its native window.

For the quickest start, select a transparent PNG of your character. Its filename
becomes its name, and it uses that image for every task state while its tooltip and accessible task label continue to update. The app copies the image, so the original can be
moved afterward. A JSON pack lets you supply a different image for each state.

Create a folder with `companion.json` and at least `idle.png`:

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

Only `idle` is required. Remove any pose you have not drawn from the manifest;
the companion uses the idle image when a particular pose is absent. Put the
character in the same position and at the same scale in each image so its
expression changes without jumping around. A square canvas with generous
transparent padding works well. Set `pixelated` to `true` to preserve the
hard edges of pixel art when it is resized.

| Pose | When it appears |
| --- | --- |
| `idle` | The operator is ready. |
| `working` | An agent is working. |
| `attention` | A conversation needs an answer or approval, or has paused. |
| `complete` | Work finished and its result has not been viewed. |
| `error` | Work failed and needs attention, or has stopped reporting its status. |
| `offline` | The backend is connecting or its status is unavailable. |

These poses reflect the app's task status. Imported poses are still images;
the pack cannot run an animation script or inspect conversations. Custom images have a small press and drag reaction on the image itself. They
do not gain eye tracking; built-in characters draw their eyes separately.
Reduced motion keeps imported images static.

Choose **View > Companion character > Add character…**, then select
your PNG or `companion.json`. The app copies the validated image data into its user-data
`companions` directory, so you can move or remove the original folder afterward.
Importing the same pack again reuses its entry. To change a character, edit your
original images or manifest and import the revised pack.

Pack names can contain 1–64 characters. Each pose must be a still PNG, at most
2 MiB and at most 2048 × 2048 pixels. Use relative filenames inside the pack
folder; subfolders are allowed. Remote URLs, paths outside the folder, SVG,
HTML, scripts and animated PNGs are not supported. The library accepts up to
64 custom companions. A corrupt stored pack is skipped when the app loads,
while other characters remain available.

When sharing a pack, include the original JSON and PNG files, together with
the artwork's license and attribution if applicable. Only share artwork you
have permission to distribute. No source-code changes are needed to try a
pack or send it to someone else.
