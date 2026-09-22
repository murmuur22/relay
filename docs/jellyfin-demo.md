# Local Jellyfin-in-Relay demo

This is a repeatable **local Chromium demonstration**, not a production installation. It uses real Relay login/grants and real Jellyfin in an isolated Docker fixture, with a synthetic 20-second H.264/AAC clip. No household library is connected.

## On the prepared development Mac

From the Relay project directory:

```sh
docker --context desktop-linux start relay-jellyfin-proof
curl --fail http://127.0.0.1:18196/health
npm run demo:jellyfin
```

Wait for `Healthy` before launching. If Docker Desktop is stopped, start it first. The launcher does not start/stop Docker or change any Docker configuration. It expects the existing named test container and private fixture credentials at `~/.hermes/test-labs/jellyfin-gateway/credentials.json`; it is **not a portable installer for another Mac**. Do not copy production credentials or libraries into this fixture.

The launcher opens a dedicated, sandbox-enabled Chromium window, creates fresh disposable Relay state, signs into a nonadmin presenter account through the normal login form, opens the Jellyfin desktop shortcut and logs in as the nonadmin synthetic Jellyfin viewer. It checks playback/audio decode/seeking and minimize/restore, then leaves the video paused at the beginning for presentation. Credentials are never printed. Synthetic Relay credentials are test fixtures, not production secrets or an authentication bypass.

Keep the terminal running. Close Chromium or press Ctrl+C in that terminal to stop the demo, revoke its routes, and remove disposable Relay state. The Jellyfin fixture container remains running for restart; when finished:

```sh
docker --context desktop-linux stop relay-jellyfin-proof
```

## Suggested presentation

1. Explain: “This is a local prototype using an isolated Jellyfin test library.”
2. Press Jellyfin's Play button: the video plays **inside the Relay desktop window**, not as a screenshot stream.
3. Drag or resize the Relay window. Use its maximize control if useful; Jellyfin fullscreen would hide the desktop you are demonstrating.
4. Minimize and restore from the dock: the same app session stays mounted.
5. Seek using Jellyfin's timeline.
6. Show **End app session** last: it removes the embedded app and invalidates its gateway access. Reopen requires a new Jellyfin login. For a quick reset without looking up fixture credentials, close Chromium and rerun the launcher.

The video is deliberately a generated test pattern with a tone. Positive audio-decoder counters do not establish that the Mac/projector speakers are audible: check volume/output yourself before presenting. HLS/transcoding, a real media library, long playback and public remote access are not qualified by this demo.

## Repeatable verification and fallback

```sh
npm run demo:jellyfin:verify
# Same verification in an actual visible browser:
node tools/demo-jellyfin.mjs --verify --headed
```

Checks real video/audio decode, seek, minimize preservation, End invalidation of the old capability, fresh-login reopen, Close cleanup and browser requests confined to gateway origins. Successful verification saves:

- `screenshots/jellyfin-demo/playing.png` — actual embedded playback.
- `screenshots/jellyfin-demo/fallback.webm` — actual browser recording (no audio track), including setup and tested controls; not a simulated UI. Open in Chromium if the default media player does not support WebM.

Fresh state is created on each launch, so a broken browser session can be reset without changing the production Relay or test Jellyfin accounts. Running verification while the visible demo is open creates another independent session; close the demo before resource-heavy full regression tests.

## Explicit boundaries

The dedicated Chromium process uses exact test-certificate SPKI acceptance and local hostname resolver rules. No system trust, hosts, DNS, router, firewall, production VM, or production data changes occur. This is not trusted Safari or public-PKI qualification. Do not substitute blanket TLS bypass flags. The fixture's Cast plugin is disabled; casting is not demonstrated. End controls gateway access, not deletion of already downloaded data or revocation of Jellyfin-issued tokens at Jellyfin.

The source version is defined in `package.json`; demo tooling does not publish or deploy a release. These commands do not modify production.
