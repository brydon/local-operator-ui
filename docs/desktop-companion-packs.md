# Make a desktop companion

Choose a PNG for a one-look character, or a JSON manifest for multiple
expressions, from **View > Companion character > Add character…**.
The desktop companion also offers three built-in characters: Sprout, Hoodie
and Pixel. It does not need a plugin, an API key or a model request.

For the quickest start, select a transparent PNG of your character. Its filename
becomes its name, and it uses that image for every task state while the status
label continues to update. The app copies the image, so the original can be
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
the pack cannot run an animation script or inspect conversations. Custom images remain static, including when reduced motion is enabled.

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
