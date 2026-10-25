# Personal desktop: folders, appearance and private URLs

## Personal home and Native bookmarks (Unreleased local source)

The only virtual root is home, displayed as `~`; canonical URLs remain `/desktop`. This is not an OS home directory or filesystem access. New accounts receive their available apps at this root. No user-created Desktop-named folder is removed or flattened. Version-1 state migrates to version 2 with the same item IDs, keys, slots, parents and appearance; only an empty owner-scoped bookmark collection and schema revision are added. Older validators cannot read version 2: source rollback needs matching protected personal state, not an in-place downgrade.

Right-click blank space, use Shift+F10/ContextMenu, or Navigation → Add app to enter URL, name and a bundled icon. The resulting Native shortcut is private to the current internal user UUID, with a separate `personal-<UUID>` identity; it never enters shared registry/grants. At most 64 bookmarks and 256 total desktop items are stored. Per-owner operations are serialized/atomic and bounded to 32 pending jobs. URLs are explicit HTTP(S), capped at 2,048 characters, with credentials/fragments/control characters, prohibited network literals and management/Gateway cookie hosts/namespaces refused before any contact. Previously used Gateway hostnames/namespaces remain reserved until runtime restart. Bookmarks made unsafe by a later configuration are hidden, not destroyed. Navigation → Unavailable shortcuts lists only the owner's retained labels/IDs and provides confirmed deletion without granting launch/icon access. Gateway activation refuses an existing private shortcut that would share its new cookie hostname/namespace; candidate names are temporarily reserved while prior owner writes drain, and newly created shortcuts recheck URL policy immediately before commit. The refusal never exposes another owner's label or URL.

A full desktop does not evict user content or prevent login/cleanup after new grants or role promotion. Missing shortcuts are deferred, remain available in Navigation, and fill free slots on the next reconciliation after an owner removes a folder or personal shortcut. Revision exhaustion refuses mutation without writing an invalid state.

Personal Add app offers Relay window (the validated legacy default) or New tab. The personal shortcut's **Edit** context action changes name, URL, icon and opening behavior without changing its internal app/item IDs, stable route key, parent folder or slot. The existing owner-serialized desktop PATCH API accepts URL/open behavior only for that owner's personal Native item; it cannot edit shared app definitions, grants or Gateway/Streamed authority. URL edits repeat syntax/authentication-host policy at commit and do not depend on DNS or reachability. URL or mode changes close old owner Relay windows; ordinary appearance-only edits retain them. Unchanged uploaded icons are omitted from the edit payload and retained; **Use app default** explicitly sends null, and a chosen upload uses the existing normalized private icon API after the details save (not a cross-file atomic transaction).

Open in new tab is always an explicit `noopener noreferrer` gesture, including when an iframe appears to load. Saving or loading a private route never auto-opens a tab. New-tab and frame destinations come only from validated owner metadata. Upstream X-Frame-Options/CSP, mixed-content, TLS and privacy restrictions still apply; Relay does not force embedding. No arbitrary proxy, Gateway route, Streamed context or server-side URL/icon fetch is granted. Use Remove shortcut to delete only the personal launcher. As with managed Native destinations, direct visits/redirects cannot be comprehensively policed by Relay: use trusted sites and a dedicated authentication hostname. The optional persisted `openMode` field accepts only `window` or `tab`; absent legacy fields default to window. Older validators may reject the new field, so source rollback requires matching protected personal state.

The searchable grouped picker includes 68 audited free Pixelarticons from npm 1.8.1. The integrity-pinned source, tarball/license/SVG/path digests and exact inventory are in `public/licenses/pixelarticons-sources.json`; the original MIT notice is `pixelarticons-MIT.txt`. `tools/bundle-pixel-icons.py` verifies input integrity and accepts only fixed filled geometric paths. A bounded useful subset avoids a full font/React pack; missing generic world and stroke-only gift were not substituted or admitted. Legacy icons remain selectable for compatibility. No CDN, paid Pro assets or arbitrary SVG markup is loaded. The generated catalog lives under server so standalone packaging includes backend validation data, while Vite imports the same fixed catalog.

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

Root home (`~`) and folder breadcrumb segments are real links. Normal clicks navigate within the app; modified clicks retain normal browser behavior. Reload and login preserve the private route; browser Back/Forward reconcile it. Unknown URL parameters never become upstream navigation or redirects.

## App windows and maximize

The existing maximize control now persists maximized state and bounded restore geometry and updates the URL. It fills the desktop area, not the browser's fullscreen mode. A valid maximized deep link opens the permitted app once; restoring returns its prior normal bounds.

Folder/path navigation and maximize/restore keep keyed native iframes intact. Unavailable locations hide retained windows so a previous maximized app cannot cover the error/recovery controls. The window stacking layer stays below navigation chrome. Native tab-mode apps still need an explicit user gesture to launch; they do not pretend to be an in-Relay maximized window.

Queued window writes retain the authentication epoch that created them. Route reconciliation rechecks navigation generation after asynchronous work, so old responses cannot resize a newer account's window or reapply an obsolete maximize state.

## Persistence and boundaries

Personal state lives in `.runtime/users/<internal-user-id>/desktop.json`, with private normalized icons under that user's `icons/` directory. Writes are serialized and atomically renamed with private permissions; corrupt trees are refused rather than reset. Current limits are128 folders,256 stored items and slot ordinals0–1023. This is single-gateway-process persistence, not a cross-process database or fsync/crash-recovery guarantee.

The parent application's app grants, login/session model, URL validation and browser isolation remain authoritative. Private path keys are not passwords, and copying a private URL does not publish it or grant another user access. Tabs sharing a login still share its live window/browser session; personal desktop metadata is per account.

No public sharing is enabled. See [Public sharing proposal](public-sharing-plan.md) for separate publication records, curated exploration and guest-access options. Chromium tests and touch emulation are not Safari/physical-device qualification; animated drag ghosts and edge auto-scroll remain possible polish.
