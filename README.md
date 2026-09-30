# Desktop companion showcase

Media for the Local Operator desktop companion pull request. Kept on a separate branch so presentation files do not enter the product diff.

- **Character reel (24.6 seconds):** arranged preview of the unmodified React artwork, enlarged and at normal desktop size. The product displays one selected companion at a time.
- **Chat demo (12.5 seconds):** actual Electron controller, preload, and renderer; sample local tasks and a synthetic assistant reply. Demonstrates compact input, reply, notifications, and a draft surviving collapse.
- **Screenshots:** the four character choices, compact chat, and local task attention.

Captured in isolated, hidden, unfocusable macOS Electron windows without real user content or model requests. Character artwork is identical in both source commits named in manifest.json. Clips are silent. All media files are below 10 MB.

The additional welcome and Appearance screenshots capture the production components, preload and trusted settings IPC in an isolated Electron carrier, not the full Settings route. The chief-of-staff screenshot uses the real companion renderer with synthetic shared-history data. These were captured at `3447db0e2`; their source and dependent styles are unchanged by upstream sync `994c5e190`. The earlier chat clip predates shared chief-of-staff routing; the new still shows that integration.

The conversation-switching stills were captured at `8ba457724` using the actual built companion with synthetic backend responses. Native menu selection and dismissal were scripted; these frames demonstrate the preserved draft and clearer disabled-chief message, not OS popup geometry.
