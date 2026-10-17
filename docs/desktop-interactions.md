Relay desktop interactions — candidate source, not release qualification

Single click selects. Shift/Ctrl/Cmd click toggles membership. Double click, Enter, or Actions → Open launches the focused shortcut. Space toggles focused selection. Drag blank space beyond 7 pixels for a marquee; blank click clears. Tab uses ordinary visible controls; focused app inputs and frames never enter the desktop key handler.

Apps and folders can move together using drag, Move selection, or the catalog shortcut. All members must be visible siblings in the captured source folder. Requests capture auth epoch and source folder at enqueue; backend authority and revision conflict checks decide the full batch. No optimistic partial move is displayed. A stale revision requires a fresh read and explicit retry, never automatic mutation replay.

Backend contract: POST /api/desktop/move with revision, sourceParentId, itemIds, parentId and optional slot. Consecutive ordinal placement preserves a contiguous group's grid shape when it fits; sparse groups compact in old slot / ID order into the first free consecutive run when no target is requested. Hidden slots remain reserved. A requested colliding run is rejected, not partially moved. Parent and descendant targets are rejected. POST /api/desktop/sort with revision, parentId and by=name|type sorts only direct children atomically. Type groups: Folders, Native, Streamed, Gateway, System; names use the backend's fixed case-normalized comparison with exact label then ID ties. Registry/grants and descendants are untouched. These endpoints require the backend worker's implemented contract; this frontend alone does not supply server authority.

Sort by opens on hover, focus, right arrow or touch click; its nested panel has a 250 ms pointer grace. Left arrow returns to the parent; Escape/Tab/outside pointer dismiss. The submenu is inline to remain reachable on narrow screens.

Profile uses the Add app black 60% scrim. Outside clicks do not dismiss either editor. Focus stays contained; Escape closes when not saving; return focus is Navigation if the invoking entry has unmounted. Auth loss/account replacement removes modal and inert state. Control Panel remains an application window, not a modal. Core colors stay neutral.

Status consumes server source/time/reachability. UP means only a server-observed HTTP response, never client connectivity or app readiness/login. Not monitored is neutral; confirmed failure is unavailable; old observations are stale. Personal Native URLs are never server-probed. Show app status off hides observations and suppresses status reads. Desktop does not run client URL probes. Existing update launch/recovery compatibility is unchanged.

New folder uses pixel-folder; Control Panel pixel-monitor; Updater pixel-git-branch. All three already exist in the audited 68-icon free MIT Pixelarticons 1.8.1 catalog; no new asset, Pro/CDN source or notice change is needed. Explicit legacy/custom icons and personal placement remain authoritative. Server defaults are owned by the backend worker.

Generated keyboard catalog (src/shortcuts.js; consistency-tested)

Desktop interaction catalog

desktop
  Ctrl+a — Select all visible items
  Escape — Clear selection
  Enter — Open focused item
  Space — Toggle focused item selection
  ContextMenu — Actions for focused item
  Shift+F10 — Actions for focused item
  Ctrl+Shift+m — Move selection…

folder
  Ctrl+a — Select all visible items
  Escape — Clear selection
  Enter — Open focused item
  Space — Toggle focused item selection
  ContextMenu — Actions for focused item
  Shift+F10 — Actions for focused item
  Ctrl+Shift+m — Move selection…

menu
  Escape — Close dialog / dismiss menu
  ArrowDown — Next menu action
  ArrowUp — Previous menu action
  Home — First menu action
  End — Last menu action
  ArrowRight — Open Sort by submenu
  ArrowLeft — Return to parent menu
  [Shift]+Tab — Dismiss menu

modal
  Escape — Close dialog / dismiss menu
  [Shift]+Tab — Next / previous dialog control

settings-tabs
  ArrowRight — Next Control Panel tab
  ArrowLeft — Previous Control Panel tab
  Home — First Control Panel tab
  End — Last Control Panel tab

On macOS, Cmd replaces Ctrl. Only the focused Relay desktop/menu/dialog handles these keys.
Native iframe and streamed app inputs are not Relay shortcut contexts. Browser-native dialogs retain native Escape/Tab behavior.
