# Personal desktop: folders, appearance and private URLs

## What belongs to the user

Each account has its own folders, app display-name/icon overrides and grid positions. These are virtual desktop organization, not filesystem directories containing upstream app data. Renaming a shortcut does not rename the global app; moving it does not grant or revoke access.

Newly granted apps appear once in the root's first free grid slots. Revoked/disabled shortcuts are hidden but their personal placement/appearance is retained for regrant. Permanently removed registry apps are cleaned from personal metadata and unused icon assets so historical entries cannot exhaust the desktop limit.

## Controls

- Right-click blank desktop space for **New folder**. Navigation also provides New folder.
- Right-click an app or folder, use Shift+F10/ContextMenu, or tap its visible ellipsis actions for Open, Rename, Change icon and Move to.
- Folders support nested organization. Drag onto another folder to move into it, or use Move to for keyboard/touch access. Self-parenting and cycles are rejected on the server.
- Drag to a grid position to move/swap. Positions snap to fixed cells that fill from the top-left downward, then into the next column. Ordinal slots persist; the number of rows adapts to the viewport, so another screen can reflow the same order. Large/sparse arrangements scroll within the desktop, not the page.
- Folder removal requires confirmation and moves its contents up one level. It never deletes registry apps or their upstream data.
- **Reset appearance** returns an app shortcut to its registry name/icon without changing its folder or permissions.

## Icons

Choose from the existing app icons and neutral line presets, or upload PNG, JPEG or WebP up to 1MiB. The server decodes real raster data, rejects mismatched/invalid/animated/oversized inputs, strips metadata and writes a PNG fitting within128x128. Decoded images are capped at4,000,000 pixels; the normalization subprocess has bounded time/output/concurrency. The existing Pillow environment installed by `npm run setup` is used.

Icons are private authenticated assets, not public static files. Reads and queued commits check the current owner and app grant. SVG/HTML and external icon URLs are not accepted. Replaced/reset/unreferenced assets are cleaned; storage is capped at128 assets /8MiB per user. Decoder work may finish within its bounded deadline after a disconnect, but stale writes cannot commit.

## Readable private paths

Root is `/desktop`. Folder segments and selected apps combine a readable name with a stable eight-hex key:

```text
/desktop/projects--<key>/sketches--<key>
/desktop/projects--<key>?app=journal--<key>
/desktop/projects--<key>?app=journal--<key>&view=maximized
```

These are illustrative shapes; `<key>` stands for the account's actual stable key. Names are decoration, not authorization or disk paths. Keys are resolved only in the signed-in user's visible desktop. Current labels and folder ancestry produce canonical links after rename/move; invalid, foreign and revoked entries produce an unavailable view rather than exposing another user's data. The server serves only the generic login shell at deep desktop paths; APIs, icons, native content and WebSockets remain protected.

Home, Desktop and folder breadcrumb segments are real links. Normal clicks navigate within the app; modified clicks retain normal browser behavior. Reload and login preserve the private route; browser Back/Forward reconcile it. Unknown URL parameters never become upstream navigation or redirects.

## App windows and maximize

The existing maximize control now persists maximized state and bounded restore geometry and updates the URL. It fills the desktop area, not the browser's fullscreen mode. A valid maximized deep link opens the permitted app once; restoring returns its prior normal bounds.

Folder/path navigation and maximize/restore keep keyed native iframes intact. Unavailable locations hide retained windows so a previous maximized app cannot cover the error/recovery controls. The window stacking layer stays below navigation chrome. Native tab-mode apps still need an explicit user gesture to launch; they do not pretend to be an in-Relay maximized window.

Queued window writes retain the authentication epoch that created them. Route reconciliation rechecks navigation generation after asynchronous work, so old responses cannot resize a newer account's window or reapply an obsolete maximize state.

## Persistence and boundaries

Personal state lives in `.runtime/users/<internal-user-id>/desktop.json`, with private normalized icons under that user's `icons/` directory. Writes are serialized and atomically renamed with private permissions; corrupt trees are refused rather than reset. Current limits are128 folders,256 stored items and slot ordinals0–1023. This is single-gateway-process persistence, not a cross-process database or fsync/crash-recovery guarantee.

The parent application's app grants, login/session model, URL validation and browser isolation remain authoritative. Private path keys are not passwords, and copying a private URL does not publish it or grant another user access. Tabs sharing a login still share its live window/browser session; personal desktop metadata is per account.

No public sharing is enabled. See [Public sharing proposal](public-sharing-plan.md) for separate publication records, curated exploration and guest-access options. Chromium tests and touch emulation are not Safari/physical-device qualification; animated drag ghosts and edge auto-scroll remain possible polish.
