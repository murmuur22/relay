# Private standalone deployment

Standalone runs **Relay only**. It starts no Parcels/Keepsakes backend, seeds no builtin/demo apps, and refuses incompatible development registry state. External web apps can be registered afterward; registration does not install an upstream service.

This is a private systemd deployment path, not a public-Internet release pipeline. Keep existing services and their data/configuration separate.

## Layout and prerequisites

- Linux x86_64 Node26.8.1 toolchain at `/opt/relay/node` (verify the official HTTPS archive against its published SHA256 manifest).
- Source pinned to a verified Git commit under `/opt/relay/releases/<commit>`; `/opt/relay/current` selects the active release.
- Built `dist/` and runtime npm dependencies. Code and browser binaries should be root-owned and not writable by the service user.
- Dedicated non-login, non-sudo OS user/group `relay`.
- Private state `/var/lib/relay`, mode0700; accounts, folders, icons and setup credentials stay here, not in the release tree.
- Playwright Chromium under `/opt/relay/browsers`, with its Debian browser libraries/fonts installed by the operator. Use Playwright's `install-deps --dry-run chromium` to inspect the package plan before installation. Do not disable the browser sandbox as an installation workaround.
- A Python interpreter with Pillow for icon normalization. Debian's `python3-pil` with `/usr/bin/python3` is an option; this is a decoder dependency, not a Keepsakes installation.

For a Relay-only artifact, exclude `integrations/`, tests, private runtime/data, screenshots and unverified font binaries from the server release. Root `npm ci --ignore-scripts` and `npm run build` do not install the nested integration packages. After building, `npm prune --omit=dev --ignore-scripts` can remove build/test-only dependencies. Do not run the development `npm run setup` on this installation.

## Runtime environment

The provided `relay.service` sets:

```text
RELAY_PROFILE=standalone
RELAY_STATE_DIR=/var/lib/relay
RELAY_HOSTNAME=localhost
PORT=4190
RELAY_ICON_PYTHON=/usr/bin/python3
PLAYWRIGHT_BROWSERS_PATH=/opt/relay/browsers
```

`RELAY_STATE_DIR` and a supplied `RELAY_ICON_PYTHON` must be absolute paths. Supported hostnames are deliberately only `127.0.0.1` and `localhost`; this chooses the exact origin/cookie hostname, not a public listener. The bind remains127.0.0.1. Unsupported configuration fails rather than silently falling back to another profile.

With the operator environment set, `npm run setup:standalone` checks Pillow and installs matching Chromium only. The template uses a nonroot user, private temporary storage, read-only system/code, empty capability bounding set and resource limits (MemoryMax2G, CPUQuota100%, TasksMax512). The operator must verify these settings on the actual host. Do not add namespace/JIT restrictions that break Chromium and then bypass its sandbox.

Optionally add host-specific `InaccessiblePaths=` entries in a unit drop-in to hide neighboring services' private directories and Docker socket from Relay's mount namespace. This must not change those directories' actual permissions or disrupt their owning services.

## Qualification before activation

Build first. Run `node deploy/verify-standalone.mjs` as nonroot, with the same browser/Python environment and matching systemd hardening, but a **separate temporary qualification directory**. The smoke never uses `RELAY_STATE_DIR`; optionally set `RELAY_QUALIFY_DIR` to an existing private writable test parent.

The smoke exercises real enrollment/login, an empty builtin catalog, a local synthetic streamed app, received frames and typed input, private PNG icon decoding, restart persistence and absence of `--no-sandbox` in both owned browser command lines. It removes its temporary state and processes. Do not qualify by creating test accounts in the real production state or probing real household data.

Then install/verify the unit (`systemd-analyze verify`), reload systemd, enable/start `relay.service`, inspect status/logs, verify the loopback listener and unauthenticated API denial, and recheck any neighboring application health. A successful service start is not a substitute for the browser smoke.

## Private access

Forward the **same port** to preserve the exact origin:

```sh
ssh -N -L localhost:4190:127.0.0.1:4190 YOUR_SSH_USER@YOUR_VM
```

Open `http://localhost:4190`. The localhost cookie hostname is distinct from a separate local preview at127.0.0.1. The tunnel must be active; this is not a LAN/public listener. A future HTTPS/Gatehouse setup requires explicit external-origin/cookie/proxy design, not globally disabling Host/Origin checks.

Initial enrollment requires the owner-only `/var/lib/relay/setup-url.txt`. Obtain/open it privately through operator access, never paste its credential into chat/logs/Git. The owner chooses the admin password. After enrollment, use normal login; the protected file is not a permanent bypass. For custom state directories, the development `npm run open` helper is not the remote operator workflow.

## Operations, backup and updates

- Status: `sudo systemctl status relay --no-pager`
- Logs: `sudo journalctl -u relay --no-pager` (do not add logging of setup URLs, cookies, credentials or typed content).
- Stop/restart: `sudo systemctl stop relay` / `sudo systemctl restart relay`. Restart invalidates sessions and ephemeral upstream browser logins.
- Back up `/var/lib/relay` with owner-only permissions, preferably with Relay stopped for a consistent multi-file snapshot. Store copies off the VM as part of an explicitly configured backup plan; RAID or the source repository is not a state backup.
- For updates, review the changelog, stage a verified commit separately, install/build its pinned dependencies and browsers, qualify it with separate state, stop Relay, back up state, atomically change `current`, and restart/verify. Do not modify the neighboring application's unit/container/configuration.
- Roll back by selecting the previous qualified release and, where schema compatibility requires it, restoring its matching protected state backup while stopped. On a first installation there is no prior release: stop/disable Relay and retain state for diagnosis rather than deleting accounts.

The admin Control Panel does not manage systemd or perform root updates. A GitHub push does not automatically update this server.

## Limits

No public sharing, public port, reverse-proxy route, SMB mount or other application installation is implied. This installation procedure explicitly supplies a fresh state directory and a standalone Python executable. Selecting the profile alone does not allocate new state: omitted settings retain the development defaults. Do not copy a development catalog containing builtins into it. System fallback fonts are used until reference-font redistribution rights are cleared. Linux qualification is targeted acceptance, not a load/soak test, hostile multi-tenant audit or proof that every website is compatible.
