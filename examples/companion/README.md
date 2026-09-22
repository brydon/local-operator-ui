# Your first companion

For a character with one pose, choose your transparent PNG directly from
**View > Companion character > Add character…**. No JSON file is needed.

To give your character multiple expressions:

1. Copy this folder somewhere you keep your artwork.
2. Add your character as a transparent `idle.png`, up to 2048 × 2048 pixels and
   2 MiB. The example manifest needs only this one pose.
3. Change `name` in `companion.json` to your character's name.
4. In Local Operator, choose **View > Companion character > Add character…**
   and select your `companion.json`.

The app copies the image when you import it. Add more expressions whenever you
like and import the edited manifest again. See
[the pack format](../../docs/desktop-companion-packs.md) for the optional poses,
pixel-art setting and supported file formats.
