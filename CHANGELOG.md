# Changelog

Meaningful user-facing changes, security fixes and migration notes for **WE relay**.
Versions describe the source/application, not a production deployment or a GitHub Release. Earlier unversioned development commits are grouped into the first version containing them; no retrospective releases are invented.

## [0.7.0] — release candidate (unpublished)

- Prepare the inherited management/guided/Agent access source as 0.7.0, synchronizing only root package/lock versions. Shared `version.js` remains the single runtime/UI version source; independent updater UI tooling retains its own version. No dependency upgrade or release date is asserted.
- Relative to stable v0.6.11, include target-scoped management WebSocket policy, protected administrator-only tabs and aggregate-status isolation; typed guided Cockpit setup/checks with separate target/app saves and stale-save recovery; and session-bound experimental Agent API/CLI plus Control Panel issuance/revocation and once-only disclosure. Detailed inherited development notes remain below rather than regrouping unrelated historical Unreleased entries.
- Explicitly include the dependency-free `tools/relay-agent.mjs` client in the runtime archive. Invoke `node /absolute/extracted-runtime/tools/relay-agent.mjs --help`; use protected owner-only token files, never credential arguments or URLs. A synthetic archive regression checks exact client bytes and extracted help with no source fallback; actual release archives require separate qualification.
- Credentials are short-lived (1–900 seconds), administrator/session-bound, read-only by default and current-password issued/revoked. Plans have revision checks; target/app saves are not cross-file transactions or fault recovery. Hiding disclosure does not revoke or clear the clipboard. Inherited client TLS evidence uses a verifying loopback adapter and genuine canonical API, not public/native HTTPS ingress.
- Gateway remains experimental. Authentic Cockpit local evidence is not universal service/browser/public-ingress support. Fresh authentication/idle policy, hostile-filesystem/total client deadlines, narrow visual and adverse fixture cleanup limits require explicit scope assessment, not claims of passing qualification. Existing protected runtime backups and matching-state rollback remain necessary; runtime update does not replace the independently installed privileged updater or provision network/TLS infrastructure.
- Admit exact signed-stock v0.6.11 as an additional existing v3 mTLS upgrade/rollback qualification baseline, with local RED/GREEN guards and sibling/malformed-version negatives. Preserve newer-target validation, fresh-host acknowledgments, signed installed control-plane identity, migration policy and v0.6.5-only web bootstrap scope; manually modified/mixed installations are not admitted. Local harness admission is not a signed upgrade result.
- Require the exact root `THIRD_PARTY_NOTICES.md` input in both runtime and control-plane archives, using the existing no-link, regular-file and size guards. Packaging regressions cover byte equality, absent-input refusal and unsafe notice inputs; no general Markdown admission, dependency upgrade or updater behavior change.
- Full integrated local/source/export/package review, official Linux, signing/provenance, fresh install, stable-predecessor upgrade/matching-state rollback and stable discovery/promotion remain separate gates. No publication, installation or deployment performed.

## [Unreleased] — retained development history (not a release inclusion list)

- Keep once-only Agent access disclosure until its issuance-response expiry even while credential inventory refresh is delayed. Hide, page leave, blur and actual expiry still clear disclosure; completing a delayed refresh cannot redisclose it. Server access lifetime and revocation are unchanged.

- Add focused Control Panel → System → Agent access: explicit read/configure scope and 1–900-second lifetime, current-password issuance/revocation, once-only disclosure and explicit copy. Hide/cancel, page leave, browser blur and expiry clear local disclosure; credentials stay session-bound and never enter persistent browser storage. The experimental CLI shares canonical Gateway target/app IDs with the panel; compiled local roundtrip tests cover both edit directions, stale-plan conflict and revocation. HTTPS client qualification and independent acceptance remain separate; no deployment or durable automation is implied.

- Correct two guided Cockpit workflow transitions: reconcile Gateway state after returning from an uncertain target save, refuse stale changes if refresh fails, and use route-specific recovery instructions. Switching a reviewed HTTPS destination to HTTP visibly removes TLS-only fields instead of stranding Certificate. Preserve strict server validation, separate app drafts and saves, and existing authority/TLS boundaries; independent rereview remains required.

- Connect a typed, seven-step Cockpit setup to the real managed Gateway and Add app flow, with versioned declarative defaults, protected service CA paths, independent truthful check tiers and explicit separate target/app saves. Explicit current-password checks make one bounded credential-free request to a fixed private target; no automatic probes, trust installation or service credentials. Preserve operator read-only configuration and existing generic targets/grants; stale base configurations conflict instead of overwriting newer settings. Gateway app retries in Control Panel are exact-session/in-memory idempotent. Fresh launch authentication, configurable idle enforcement, authentic-service qualification and independent acceptance remain separate gates. No release or deployment is implied.

- Add an isolated management-gateway candidate with target-scoped `webSocketProtocols`, server-derived opt-in `webSocketOrigin`, `presentation: "tab"` and enforced `accessPolicy: "admin-only"`. Preserve legacy defaults, verified upstream TLS, live authorization and upstream CSP/XFO. Ordinary-user aggregate status marks a granted admin-only target unavailable without probing it or suppressing unrelated permitted observations; launch/use denial and session/grant/admission failures remain enforced. Protected tabs use one-use non-URL handoff, sever the opener and carry a CSP sandbox; tab components may frame only their own isolated origin. End/Close/logout retire gateway access even when the browser retains a disconnected tab. Add synthetic TLS/WSS and compiled-browser regressions plus an unprivileged, loopback-only disposable Cockpit fixture. Actual Cockpit 337 password login, dashboard/live channel and End were exercised locally; independent review, broader compatibility and release qualification remain separate. Fresh-authentication/idle-policy UI integration, generalized authentication challenges and other services are not implemented by this slice.

- CLEANUP-1 follow-up to the isolated proposal below: retain pending updater-embedding fixture acquisitions before starting setup, deny post-retirement use, and await acknowledged disposal of late browser/web/listener results. Listener acquisition errors reject explicitly. Add bounded fixture regressions; original framing/API assertions, sandbox and deadlines remain unchanged. This test-only candidate still requires independent review; it does not qualify a release or explain the historical hosted failure.

- Isolated publication-diagnostic proposal: register updater-embedding fixture ownership before listener/browser setup, settle every owned cleanup and retain cleanup rejections. Controlled setup failures now exit with their original failure instead of leaving listeners alive. Original framing/API security assertions, Chromium sandbox and deadlines are unchanged. Historical publisher attribution and hosted qualification remain unresolved; no tagged bytes are replaced.

- Align current guides with implemented status modes: personal Native bookmarks are not monitored, managed/Gateway status uses bounded Relay-side checks, and Native device CORS checks belong to explicit wizard tests. Correct the development enrollment path and independently pinned updater UI tooling version. Runtime, recovery, supported baselines and dependency pins are unchanged.

- Remove the unused internal gateway status pass-through helper; active status probes retain their live-observer, preference and definition checks. Add an authenticated two-observer regression for a hidden observer during a held managed Native check. No API, state schema, resource lifecycle or dependency pin changes.

- Separate standalone dependency-security qualification (Relay and independent updater UI) from explicitly selected optional Parcels coverage. Reuse the same Vite file/CORS and source-map assertions across all three consumers; missing selected dependencies still fail. Release workflows install only required consumers. Keep native/hybrid demos and compatibility/security/lifecycle/rollback tests; no runtime feature, dependency pin or state format is removed.

- Local 0.6.9 helper-repair candidate only: let Relay own SIGTERM-driven streamed-browser shutdown instead of racing Playwright's default handler, which treats a second close as forced escalation. Browser sandbox, existing assertions and shutdown deadlines remain unchanged; SIGINT behavior is not qualified by this change.
- Give the updater UI's POSIX Playwright test server direct Vite ownership and bounded SIGTERM teardown. Pinned Vite intentionally exits 143 after acknowledged close; qualification requires identity-bound functional completion before TERM and complete closure evidence, never a blanket 143 waiver or conversion to zero. No installed updater/control-plane change is included.
- Independent review of this isolated candidate remains required before source acceptance or publication.

## [0.6.11] — corrective preparation (unpublished)

- Advance only the root package/lock to 0.6.11; preserve immutable v0.6.10 after its failed publisher run with no release/assets. Stable/latest remains v0.6.8 at preparation readback. Independent consumer versions and all runtime, dependency and workflow bytes are unchanged from 0.6.10.
- Integrate the independently accepted three-path Caddy test-fixture correction: hold distinct backend/edge reservations during setup, retain bounded sanitized Caddy/readiness diagnostics, and add reservation-ownership regressions. The external descriptor handoff remains non-atomic: truthful bounded failure is guaranteed under the accepted fixture contract, not elimination of port races. Original TLS/security assertions, Chromium sandbox and test deadlines remain intact.
- Rebuild and qualify an exact post-bump source freeze. Earlier macOS 8/8 and local Linux retained-PKI readiness results are separate from new-version and hosted Ubuntu/browser qualification. The Linux certificate-generating helper's openssl ENOENT failure remains retained; historical publisher cause is unknown.
- Full local suites, audits, packaging/extracted runtime and independent exact-version review remain separate from official Linux preflight, signed artifacts/provenance, both-mode fresh install and unchanged-v0.6.8-control-plane enabled-Gateway upgrade/matching rollback, discovery and stable promotion. No optional Parcels or updater bridge expansion, production access or independent updater replacement is included.

## [0.6.10] — corrective preparation (historical; immutable failed tag)

Later status: v0.6.10 remains immutable after its failed publisher run; no release/assets existed at 0.6.11 preparation readback. Its historical cause is unknown. The original preparation record below is retained, not a current readiness claim.

- Prepare a new root package/lock version rather than changing immutable v0.6.9 source/tag. Shared `version.js`, independent consumer versions/locks and the accepted dependency closure are unchanged.
- Integrate the independently accepted test-only updater-embedding fixture repair: register pending acquisitions before setup, retire admission synchronously and retain ownership until acknowledged late-resource disposal. Preserve original framing/API assertions, Chromium sandbox and internal deadlines; never turn an expected failed/cancelled probe into a passing test.
- Include the accepted documentation/status, standalone-versus-optional-consumer and Relay-owned SIGTERM/Vite test-server corrections described above. The v0.6.9 predecessor route already admits signed v0.6.8 and retains its unchanged control plane; v0.6.4 stock compatibility is a separate ledger, not a production mixed-installation claim.
- Full exact-version export, local suites/audits/package/extracted-runtime qualification and independent integration/version/publication review are required for this candidate. Earlier 0.6.9 local evidence is historical, not a 0.6.10 pass. Official Linux preflight, signed artifacts, anonymous provenance, both-mode install/upgrade/rollback and promotion remain separate gates. No production or updater replacement is included.
- Historical v0.6.9 publisher failure is retained with its original source and evidence. Its initial exception remains unknown; acceptance of a local fixture correction does not establish that historical cause or a universal cleanup-time guarantee.

## [0.6.9] — 2026-10-24 (historical preparation; immutable tag)

Later status: the v0.6.9 tag remains immutable; official publication qualification failed and no release/assets were published at the corrective preparation readback. The original preparation record follows, not current release readiness.

Prepared source only. The accepted integrated 0.6.8-version source and reviewed immediate-predecessor qualification route are grouped here for versioned rebuilding. New 0.6.9 clean-export/full-suite, package, independent review and hosted/signing/install/upgrade/rollback/discovery gates remain separate; no publication or deployment is claimed.

- Admit the exact signed v0.6.8 predecessor in release qualification and select its enabled-v3 Gateway fixture, preserving newer-target admission, old control-plane identity and matching-state rollback checks. Local harness evidence is not signed upgrade evidence.
- Synchronize the canonical root package/lock version to 0.6.9; retain independent Parcels 0.2.0 and updater toolchain 0.0.0 versions and shared `version.js` consumers. Rebuild desktop and independent/versioned updater presentation without changing the reviewed dependency closure.
- Explicitly select the nine added compressed-body, Vite-boundary, startup-cleanup and personal Native lifecycle/editor regressions in Linux preflight and publisher qualification commands. The exact selection delta and integrated predecessor source were independently accepted for versioned preparation; local execution is separate from hosted qualification and does not qualify the new version by itself.

- Reuse acknowledged shutdown cleanup for failed native/configured-Gateway startup, including accepted partial-management-header sockets and admitted sessions. Preserve irreversible admission and existing parser/updater deadlines; report startup plus cleanup failures without claiming success. This does not attribute any historical Linux rollback failure.
- In Add app → Gateway, select a readable existing target or explicitly review/save a new target separately using the existing protected administrator configuration/password flow. Preserve the app draft and select the saved target on return. Cancelling the app does not undo a separately saved target. Listener/DNS/TLS setup remains separate; configuration changes can retire all Gateway sessions.
- Replace repetitive Gateway target forms with a compact table and one focused editor. Operator-owned configuration remains read-only. App deletion does not delete targets; no ownership metadata, deletion cascade or cross-file app/target transaction is introduced.
- Show wizard access grants in a compact semantic user table with labelled checkboxes, exact existing identities/ACLs, keyboard interaction and neutral contained scrolling.
- Let owners choose Relay window or New tab when creating a personal Native shortcut, and edit its name, URL, icon and opening behavior from its context menu. Persist validated opening behavior with a backward-compatible window default; retain stable private identity, placement/folder and unchanged uploaded icons. URL/mode changes retire prior owner windows, while authentication-hostname URL guards, owner-serialized writes and explicit user-gesture tabs remain enforced. No shared/Streamed/Gateway authority or framing-policy bypass is added.
- Reject delayed personal Native launch outcomes after an observed URL/open-mode/identity generation or authentication change, including URL changes away and back. Recheck the live owner definition before rendering; preserve unrelated launches and protect newer reopened windows from stale cleanup.
- Also reject unobserved parallel-owner URL/open-mode ABA by checking the exact live server window's existing launch token and current definition through a final authenticated session observation after refresh awaits. Do not insert retired iframe content; retain fresh reopen and unrelated appearance/folder edits. This is not an atomic guarantee across later server edits and arbitrary browser network scheduling. The repaired integrated predecessor source was independently accepted for preparation after separate identity-bound cleanup disposition; historical rejected freezes and failed cleanup evidence remain preserved. This is not new-version full qualification.
- Apply the owner-approved compatible dependency patches: body-parser 2.4.0 through Express's existing range and Vite 8.3.5 across Relay, updater UI and Parcels. Required transitive closure is recorded in the lockfiles; no direct override, audit suppression or major framework upgrade is introduced. Local audit and regression evidence does not constitute release or production acceptance.
- Versioned local candidate only; publication is pending. Existing-install updater presentation bridge setup remains separate from runtime publication, with no privileged updater replacement or production access authorized here.

## [0.6.8] — local correction candidate

- Restore configured Gateway startup while the updater holds maintenance through expected-version readiness. Listener startup checks irreversible shutdown intent separately; external requests, login/enrollment, launches/capabilities and queued mutations retain full maintenance admission.
- Carry forward the seven desktop/status/form features and acknowledged revocation/shutdown protections listed under 0.6.7. No second UI version or updater/control-plane change is introduced.
- Local source verification only. Independent review, integrated clean-export qualification, official Linux/signing, signed install/upgrade/matching-state rollback and discovery remain separate gates before stable promotion. No production deployment.

## [0.6.7] — failed signed prerelease

Signed [v0.6.7](https://github.com/murmuur22/relay/releases/tag/v0.6.7), source `8b94c020d038a35be5de893747ef147e44113702`, remains immutable. Configured Gateway startup fails when the updater intentionally holds maintenance before readiness; signed upgrade qualification failed. It was not promoted to stable. Version 0.6.6 remains the stable baseline. The original delivery context follows; local passes do not clear that hosted failure.

- Use audited pixel defaults for newly created folders and system shortcuts without rewriting explicit legacy/custom appearance metadata.
- Select apps and folders with modifier clicks or marquee; move mixed selections atomically with revision/owner checks. Selected items use deterministic consecutive slots; sparse relative geometry is not retained.
- Add a context-aware Navigation Hotkeys catalog shared with implemented handlers and generated documentation, preserving app/modal text input.
- Sort the current folder by Name or Type through keyboard/touch-accessible context submenus, without changing grants or appearance overrides.
- Give Profile the neutral 60% modal scrim, contained focus and authenticated teardown behavior.
- Report bounded server responses for managed Native, Streamed and configured Gateway targets, with source/time and honest authentication/error states; personal URLs remain Not monitored and hidden status suppresses reads/probes.
- Harden duplicate HTTP/WebSocket authority rejection and qualify generic allowlisted form-header forwarding against read-only Exterminator v0.2.0. Operators must configure `x-exterminator`, exact embedding origin and separate submission/admin grants; this is not proof of an unknown deployed failure or universal website compatibility.
- Keep revoked sessions unauthenticated while retaining cleanup ownership until context or browser closure is acknowledged. Logout and account/service changes report applied-but-incomplete cleanup with HTTP 503; explicit shutdown retries retained managers without restoring access. Failed retirements count against existing session limits, and one failure does not skip other sessions' cleanup.
- Close admission irreversibly at shutdown intent, including in-flight login/enrollment and late session initialization. Cancel already accepted streams, deny new launches/upgrades, and wait for already-queued listener changes and acknowledged owned-resource cleanup; failed cleanup permits explicit retry without reopening access.
- Publication, full qualification and production maintenance remain separate gates. The optional updater bridge/bootstrap/control plane is unchanged.

## [0.6.6] — 2026-10-14

Published stable/latest as [v0.6.6](https://github.com/murmuur22/relay/releases/tag/v0.6.6); GitHub records publication at 2026-10-14T20:54:35Z. This supersedes the earlier local-candidate status, not its retained failed qualification evidence. Publication is not deployment.

- Prepare source 0.6.6; published v0.6.5 source, signatures and artifacts remain immutable.
- Close runtime-owned management TCP sockets after normal session/operation/browser/native cleanup and listener closure. Incomplete HTTP headers and unfinished request bodies can no longer hold shutdown beyond the unchanged updater driver deadline. Preserve live HTTP/WebSocket revocation and ordinary rejection/body-drain behavior; this reproduced defect is not attributed to a historical Linux rollback.
- Refresh only supported transitive patches: devalue 5.9.2 → 5.9.4 through Svelte and source-map-js 1.2.1 → 1.2.2 through Vite/PostCSS in both build packages. Retain pinned direct dependencies, integrity-locked artifacts and behavioral security regressions; no major upgrade or audit suppression.

- Use a single virtual personal home root displayed as `~`, retaining `/desktop` links, stable owner-scoped keys, existing layouts/overrides and all user-created folders (including folders named Desktop). Version-1 desktop metadata migrates atomically to version 2 without flattening content.
- Let ordinary users add private Native shortcuts with URL/name/icon through desktop right-click, keyboard and Navigation/touch actions. Store at most 64 shortcuts per internal owner UUID, separate from administrator registry/grants; keep normalized icons private and deny management/active or retired Gateway cookie hostnames and namespaces across ports. No personal-URL server fetching, shared definitions or Gateway/Streamed grants are added.
- Bundle 68 audited free Pixelarticons from integrity-pinned npm 1.8.1 as fixed geometric path data, with original MIT notice/provenance. Searchable grouped pickers serve personal appearance, personal Add app and managed app editors; existing icon identities/uploads remain compatible. Native windows always expose a user-gesture new-tab fallback without inferring embedding from iframe load.
- Remove only the redundant Add Jellyfin target button; retain configured/preset targets, generic target creation, drafts and permission boundaries. Add numbered target headings for readability.
- Explain Native CORS-unobservable checks instead of discarding them; distinguish received HTTP errors/challenges from unreachable transport, label stale observations and bind device checks to their authentication epoch. Personal URLs are measured only by credential-free visitor-browser CORS. Gateway status uses passive actual session-owned transport response evidence, not arbitrary new probes; unopened Gateway upstreams remain explicitly unobserved. Hidden status suppresses API observations and visitor probes.
- Prevent Gateway activation from introducing a cookie-host conflict with retained private shortcuts, including a held creation racing configuration. Keep owner-only unavailable-shortcut cleanup, full-capacity role-promotion recovery and revision overflow refusal without weakening launch authority or evicting content.
- Recheck status authority before queue/DNS admission, preserve other live observation waiters, and drop ended-route/replaced-definition evidence from held responses. Make stale text age through the actual UI clock. Replace the legacy lifecycle test's fixed short sleeps with actual paused/close/context-settlement deadlines; no stream runtime behavior was changed for that fixture timing correction.
- Keep Gateway Experimental branding and capability disclaimers. This is local source/test work, not browser-wide maturity, production qualification, publication or deployment.

## [0.6.5] — 2026-10-11

Candidate source; signed publication and qualification status are recorded separately in `TEST_REPORT.md`. No production deployment is implied.

- Deliver the independently built updater presentation inside the ordinary signed runtime archive, with an inert web-API compatibility/file-hash descriptor and exact-version asset URLs. Keep the protocol-1 release manifest shape unchanged and all seven privileged broker modules byte-identical to v0.6.3/v0.6.4.
- Add an unprivileged fixed-root static bridge with complete bounded immutable frontend pins, safe fallback to the independent built-in UI, and retained lazy assets through runtime switching, candidate cleanup and rollback. Fresh installations receive the bridge; existing installations require the separately qualified, operator-controlled web-only bootstrap. Runtime updates do not change an already installed web server by magic.
- Refine both updater surfaces to a small “Relay updater” header and monochrome progress/focus accents; remove the WE RELAY wordmark, terminal subtitle and decorative slogans while retaining the byte-driven percentage, segmented bar and chamber.
- Redesign only the desktop Updater browser and independently served updater UI as a reference-led Monitor terminal: cream rules, near-black texture, minimal “Relay updater” header, a dominant actual shaded Three.js knot with dotted coordinates, monochrome artifact percentage and a byte-driven character-block bar. Release review/consent stays secondary; other desktop surfaces retain their neutral design.
- Bundle self-hosted Silkscreen Bold and Share Tech Mono Regular under their original SIL OFL 1.1 licenses, with pinned upstream URLs, source/output hashes and exact notices in both distributions. No runtime font CDN requests or private reference fonts.
- Suppress percentages for idle/unknown-total snapshots, preserve semantic artifact-only progress and all original-owner, CSRF, password, embedding, stale-state and reduced-motion/WebGL boundaries. Presentation delivery never replaces the installed broker, web API, configuration or units; no privileged self-update or production change.

## [0.6.4] — 2026-10-10

Published as [v0.6.4](https://github.com/murmuur22/relay/releases/tag/v0.6.4) after exact-source Linux preflight, official signed publication, anonymous asset verification, dual-mode signed fresh installs and unchanged-v0.6.3-control-plane enabled-Gateway runtime upgrade/matching-state rollback passed. Ordinary credential-free discovery from v0.6.3 also passed. Exact run URLs and hashes are in `TEST_REPORT.md`; no production deployment was performed.

- Redesign the independent updater as a warm-monochrome transfer terminal: a real shaded Three.js 3D knot rendered through stable ASCII cells, luminous breathing core, orbit marks and sparse inward particles; bounded elapsed-time animation, hidden/reduced-motion pauses and usable no-WebGL status fallback.
- Keep normal update review, current-password consent, byte progress, errors and recovery inside the Relay page through an independently served trusted embedded surface that survives runtime authentication loss/restart. Reconnect uses the existing Login without automatically retrying mutations. Preserve standalone direct access and an explicitly requested safe standalone recovery tab.
- Permit only the exact configured Relay ancestor for updater HTML, without relaxing API Host/Origin/CSRF or privileged broker boundaries. Validate exact message origin/source/shape; never transmit authority through messaging or retain ticket fragments in the host DOM. Retire prior administrator data on explicit logout/account switch and require matching live user identity for further mutations.
- Invalidate pending launches at logout intent, distinguish live administrator revocation from a positively observed runtime restart, require a genuine original-owner Relay cookie at monitoring exchange, and retain a concealed teardown recipient until independent logout is read back or reported unconfirmed. Keep fresh mutation authorization independent from restart monitoring.
- Allow explicit in-page authentication-metadata refresh after a previously successful Login discovery becomes stale during restart. Keep the independent frame mounted; refreshing metadata never resubmits a password or retries an updater mutation.
- Document the separate control-plane distribution/migration gate: ordinary runtime releases do not update an installed updater service/UI. The separately attested archive supplies the new control plane for fresh installs; existing-host migration remains separately approved and qualified. No privileged self-update or production/OS/network/trust change is included.
- Extend signed/preflight gates to every updater backend/frontend regression and ASCII browser case, and admit a guarded genuine v0.6.3 enabled-mTLS runtime upgrade/matching-state rollback fixture with its old control plane unchanged.
- Serve the fixed public desktop shell relative to its explicit build root so clean qualification checkouts beneath hidden parent directories work without allowing dotfiles or changing private route authentication.
- Prepare ASCII test artifacts in fresh checkouts and bound desktop qualification browser operations/cleanup with fail-closed TAP reporting; retain all rendering, lifecycle, authentication and sandbox assertions.

## [0.6.3] — 2026-09-30

Separate-VM Caddy mTLS integration. Published as [v0.6.3](https://github.com/murmuur22/relay/releases/tag/v0.6.3) after Linux x64 source, signed dual-mode installation/upgrade/rollback and anonymous artifact verification passed; old-v0.6.2 stable discovery also passed. Exact evidence is recorded in `TEST_REPORT.md`. No production deployment was performed.

- Add explicit version-3 separate-VM Caddy transport with TLS 1.2+, verified server identity/chain, client CA plus exact DNS SAN/clientAuth identity policy, and one private IPv4 socket peer. Version-2 remains loopback HTTP only; Direct HTTPS is unchanged.
- Preserve canonical browser HTTPS origins (default 443), Secure cookies, raw forwarding-header checks on HTTP/WebSockets, fixed targets, per-launch isolation and active retirement. Backend certificates are separate from Caddy's browser certificate and require deliberate renewal/reload before expiry.
- Add managed separate-VM settings, protected server file references and remote Caddy path inputs, password consent, read-only operator mode and reviewable scoped mTLS snippets. Validation does not establish external trust, remote file availability or private source policy.
- Enforce directly root-issued client leaves, complete ordered server chains including root, earliest-chain expiry retirement for active HTTP/WebSockets and fresh TLS handshakes rather than session resumption. Include a tested unprivileged offline OpenSSL provisioning recipe and explicit per-host credential distribution/rotation guidance.
- Extend real disposable Caddy/account/browser and TLS negative fixtures plus managed mode migration/restart tests. See TEST_REPORT.md for executed local and hosted results and the remaining production/browser-trust limits.

## [0.6.2] — 2026-09-30

Optional same-host reverse proxy. Publication and signed hosted qualification are separate gates recorded in `TEST_REPORT.md`; no production deployment is implied.

### Added and hardened
- Preserve Direct HTTPS and add explicit version-2 same-host Caddy → loopback HTTP mode. Canonical external desktop/app HTTPS origins are independent of the internal listener; default 443 is omitted and nondefault external ports retained.
- Require an exact trusted loopback peer and one matching Host/X-Forwarded-Host plus HTTPS protocol field for both HTTP and WebSockets. Duplicate, conflicting, missing or additional forwarding metadata fails closed; no blanket trust-proxy. Secure host-only cookies, exact Origin/CSRF and per-launch/session/grant authority remain enforced.
- Add compiled Control Panel mode selection, separate listener settings, read-only operator configuration, password/acknowledgement consent and reviewable Caddy snippets. Snippets preserve unrelated sites, overwrite forwarding metadata and default to deny-all until operator-selected source networks are supplied. Local DNS is not access control; SNAT and upstream proxy limitations are explicit.
- Retire gateway windows even when a stopped same-port listener replacement is reverted. Keep accounts, targets, grants and the private management/updater recovery path. Version-2 references require matching-state restoration when rolling back to older code.
- Qualify genuine accounts, app launch, file/Range/download bytes, WebSockets and active logout/grant revocation through a real isolated Caddy binary; keep process-local TLS test acceptance distinct from public/OS/Safari trust. Exact totals and hosted results are recorded only after execution in TEST_REPORT.md.
- Runtime updates do not edit Caddy, DNS, firewall, VPN, trust stores or certificate-provider credentials. Caddy owns certificate renewal. Remote proxy transport and production deployment remain unsupported/unperformed by this change.

## [0.6.1] — 2026-09-28

Two-stage Gateway setup and lifecycle hardening. Release publication and signed Linux qualification are recorded separately in `TEST_REPORT.md`; updating remains an operator action.

### Added
- Two-stage Gateway setup: Gateway remains discoverable beside Native and Streamed in Add app. An explicit setup handoff keeps the unsaved app draft in the Control Panel, and returns with refreshed configured targets. Saving a target is separate from registering an app and granting access.
- Administrator Gateway settings for checking protected certificate references, configuring the listener and fixed service targets, and enabling/changing/disabling with fresh password consent. Operator-owned configuration stays read-only; no DNS, certificate issuance, device trust, firewall or public-exposure automation.
- Control Panel as an administrator-only trusted desktop system window, preserving navigation, local window controls, in-memory drafts and authorization teardown alongside the independent Updater.

### Security and limits
- Retired HTTPS authentication hostnames remain excluded from Native destinations until runtime restart. Native previews and their new-tab links require authenticated policy validation before browser traffic, without making offline/client-only Native addresses depend on server DNS or reachability.
- Gateway changes retire every live gateway window across sessions even when one layout write fails. Applied-state cleanup failures are reported explicitly rather than leaving stale window authority on a replacement gateway.
- Managed references persist in protected runtime state; TLS key bytes never pass through the UI. Changes retire gateway routes, private credentials and active transfers while preserving account/app definitions and private management access. Invalid configuration, bind failure and session expiry are covered with disposable lifecycle/race fixtures.
- A running listener is not proof of DNS, browser trust, upstream availability or app compatibility. Gateway apps still require the HTTPS desktop and separate upstream login; existing private management access remains required for Updater.

### Fixed
- Keep previously used HTTPS authentication hostnames denied to Native apps until sessions are invalidated by restart, and retire gateway windows across all sessions even when one layout write fails.
- Focus gateway password consent for keyboard users and distinguish unavailable Gateway metadata from a disabled gateway, with an explicit retry.
- Allow verified release payload transfers up to ten minutes instead of two on slower connections. Metadata budgets, shorter caller deadlines, five-second socket timeouts, cancellation, byte limits and signature checks are preserved. This is an independent updater control-plane repair, not a runtime self-update or modification of the published 0.6.0 artifacts.

## [0.6.0] — 2026-09-22

Published with signed Linux artifacts and hosted initial-install/old-updater upgrade/rollback qualification; exact evidence is in `TEST_REPORT.md`. The gateway remains opt-in and experimental, and runtime installation does not provision DNS/TLS or public exposure.

### Added
- Opt-in installed gateway configuration through `RELAY_GATEWAY_CONFIG`: administrator-supplied HTTPS names/certificates, an explicit listener address, and fixed validated LAN/VPN HTTP(S) upstreams. Browser clients use the normal desktop; paid domains are not required, but DNS/TLS provisioning remains an administrator responsibility.
- Configured-origin browser handoff validation, private-suffix-aware hostname checks, protected bounded configuration reads, upstream TLS verification, and startup/refusal/restart regressions. Existing installations remain unchanged when gateway configuration is absent.
- Repeatable local Jellyfin desktop demo (`npm run demo:jellyfin`) with disposable Relay state, ordinary nonadmin logins, actual embedded playback and a separate verification/recording command. Uses only the existing synthetic fixture and a dedicated Chromium process; not a portable installer, trusted Safari qualification or production deployment. See `docs/jellyfin-demo.md`.
- Disabled-by-default experimental Gateway mode in the normal Add app/editor/desktop flow, using administrator-configured targets and secret-free registry references. The original programmatic fixture remains loopback-only; the installed opt-in path is documented in `docs/gateway-deployment.md`. No DNS or trust installation is performed.
- Normal gateway desktop windows with explicit End app session, fresh-login Reopen, session-preserving minimize, and secure Close cleanup. Credentials and active HTTP/WebSocket connections are retired; app-only Logout is explicitly distinguished from gateway cleanup.

### Fixed
- Refuse persisted native app definitions that share either authentication hostname before publishing sessions or starting listeners; enabling or renaming the HTTPS edge cannot introduce cross-port login-cookie exposure.
- Serialize the default frontend test run with an explicit timeout after reproducing concurrent updater-browser stalls; no test assertions were removed.
- Gateway Close removes local content without waiting for layout saves; pending launch/restart responses and old-account queued work cannot reopen or delete the wrong window. Cross-tab session changes invalidate the old UI's authorization epoch.
- Isolate gateway cancellation bookkeeping per actual session so another user's saturation cannot block owned-route cleanup; overflow temporarily denies that session's new launches rather than failing End cleanup.
- Updater discovery retains candidates genuinely verified during the current check if a later release times out or fails verification. Failed candidates are never offered; a failure before any verified result still fails closed. The existing eight-second budget and install-time re-verification remain unchanged. This requires a separately approved updater maintenance repair, not a replacement of the published 0.5.0 artifacts or control-plane self-update.

## [0.5.0] — 2026-09-21

### Added
- Back and Forward controls for streamed desktop windows, driven by the remote browser's actual history, with disabled states for unavailable directions, disconnection and navigation in progress. Native cross-origin iframe history is not presented as controllable.
- Visible, query-free navigation failure notices with Back/Reload recovery, including recovery from an initial page-load failure.
- Optional guarded hosted qualification of a genuine signed upgrade from the unchanged 0.4.2 control plane, followed by matching-state rollback. Actual hosted execution is recorded separately in TEST_REPORT.md.

### Fixed
- Intercept each HTTP redirect hop through Chromium Fetch and Relay's validated, DNS-pinned transport, preserving the real destination URL/origin, redirect methods, cookies and browser security policies. The deny-only fallback, sandbox and exact-origin restrictions remain enforced.
- Allow bounded runtime resource URLs up to 32,768 characters while keeping administrator registration URLs capped at 2,048 characters.
- Keep slow navigation/reload outside the global mutation queue so logout, closure and revocation can cancel work promptly. Bound redirect chains and release completed/blocked chain records.
- Use Safari-compatible Relay port 4180 for fresh installations; the independent updater remains on 4191. Runtime updates preserve operator settings and do not self-update the control plane.

### Guidance and limits
- Native app setup and windows explain embedding restrictions (X-Frame-Options/CSP and sandbox/privacy limits) and the Open in new tab alternative. Relay does not strip upstream protections.
- Wildcards remain deferred. External resource origins still require explicit approval; Google may challenge automated traffic. This release does not promise unrestricted browsing, anti-bot bypass, persistent browser profiles, streamed WebSockets/audio or file-transfer bridges.

## [0.4.2] — 2026-09-19

### Fixed
- Permit AF_NETLINK in the independent updater web service so libuv can validate the assigned private-LAN interface under systemd. Empty capability sets and NoNewPrivileges remain enforced; no network administration privileges are granted.
- Add a service-policy regression and a real hosted systemd interface-enumeration probe that asserts zero effective capabilities. Signed loopback/private-LAN qualification remains a separate release gate.

## [0.4.1] — 2026-09-19

Release preparation; deployment and private-LAN qualification are separate gates.

### Added
- MIT licensing for Relay's first-party code, with license metadata in both packages and the full license retained in both generated release archives. Third-party notices remain intact.
- Explicit private-LAN mode for assigned, canonical RFC1918 IPv4 literals. Relay and its independent updater bind only that address; loopback remains the default and LAN exposure requires standalone mode.
- Matching installer/qualification configuration and separate hosted loopback/LAN jobs. Exact Host/Origin/CSRF checks, administrator authorization, native cookie-host protection and signing-key isolation remain enforced. No wildcard/public listener or network infrastructure configuration is added.

## [0.4.0] — 2026-09-19

Published Linux x64 release: [v0.4.0](https://github.com/murmuur22/relay/releases/tag/v0.4.0). Hosted Linux preflight, real systemd mount-boundary recovery, anonymous public attestation verification and signed initial-install qualification passed; see `TEST_REPORT.md`. Publication is not a production VM deployment.

### Added
- Administrator Updater now opens a draggable/resizable/minimizable desktop browser for release notes, selection, real status and the shared Three.js chamber. Start update hands the selected release to a separate maintenance tab; only explicit confirmation and a fresh Relay administrator password there can begin installation.
- Session-scoped, bounded admin-only read/check bridge for desktop browsing, with authority rechecked after broker awaits and no rotation of an existing independent updater session. The system window remains outside editable web-app registration and server stream/window managers.
- Standalone Three.js transfer chamber with byte-driven fragment assembly, decorative spiral download trails, release notes, server-reported phases/events/history and actual artifact-byte progress. The lazy-loaded renderer respects account/device reduced motion, freezes on connectivity loss and falls back to a static view without WebGL.
- Separate updater web service and broker, protected maintenance admission, verified staging, matching-state backup/restoration, cancellation before activation and gated interrupted/failed recovery. Disposable fixtures exercise real HTTP payload transfer, Node service activation and readiness-failure rollback; they are not production release evidence.
- Separate Linux x64 runtime and updater-control-plane release archives, both bound by one GitHub-attested manifest. Verification uses public downloads and a fresh credential-free Sigstore cache, not an operator GitHub login.
- Inspect-by-default fresh-host installer, dedicated non-login service identities, protected code/key/state, durable maintenance, and guarded hosted systemd qualification. Conflicting installations are refused instead of overwritten. Prerelease publication and stable promotion are separate gates; no production deployment is implied.

### Fixed
- Stage verified candidates privately inside the install mount before atomic publication, rather than renaming across systemd writable mounts. Restore state contents without replacing the mounted state directory, using bounded no-follow descriptor operations and retaining a durable checkpoint through failure.
- Both updater surfaces disable installation of the already installed version and explain why.
- Updater content activates its desktop window without disrupting controls; local close and pending-launch cleanup no longer wait for unrelated application saves. Layout follows the resizable window width, not only the browser viewport.
- The selected update version survives independent-tab refresh as a validated, non-secret history hint. Missing versions require explicit reselection; hints never authorize or automatically start installation.
- Open authorization dialogs now disable submission visually when monitoring loses connectivity. New snapshots that revoke action eligibility or change the captured release/job invalidate consent and clear the password, requiring a fresh review instead of reviving an obsolete confirmation.
- Decorative trail endpoints stay on one traversal across the loop boundary, preventing long flashing spokes as particles reset.

### Verification boundary
- Verified on macOS and disposable hosted Ubuntu 24.04 x64. Scripted UI previews, HMAC-signed multi-version fixtures and the genuinely GitHub-attested baseline installation are separate evidence. Existing-state migration, control-plane self-updates, host power-loss testing, a second signed-version upgrade and production VM deployment are not established by these results.

## [0.3.0] — 2026-09-19

### Added
- Relay-only standalone profile with an empty builtin catalog, no bundled app processes/routes, explicit private state/Python configuration and strict localhost-origin support for SSH forwarding.
- Chromium-only standalone setup, a nonroot bounded systemd service template and an executable standalone qualification smoke for real streaming, icon decoding and restart persistence.
- Per-user folders, nested organization, top-left/downward grid-snapped drag/drop, context menus and keyboard/touch alternatives.
- Personal app names/icons without changing registry definitions or grants; premade icon gallery plus private normalized PNG/JPEG/WebP uploads.
- Clickable breadcrumb navigation and readable private desktop/app URLs with stable short keys, login/reload/Back/Forward handling and URL-backed maximize/restore.
- A separate public-sharing design proposal covering single-app links, curated exploration and restricted access. No public sharing is enabled.
- Restrained monochrome signal-settling intro with the exact keyboard/click/tap prompt `[ESC] BYPASS INITIALIZATION`, once per tab session. Bypass dismisses decoration only, never authentication.
- Login fade, desktop icon/dock reveal, window opening/minimize/restore and Navigation motion. Native iframe state survives minimizing, and drag/resize remains immediate.
- Independent per-account Intro animation and Interface animations controls. Device reduced-motion settings take priority, including changes while Relay is running; pre-login display can use the last locally saved motion booleans.
- Protected first-run administrator wizard: create the admin password, optionally add the first real app, then enter the desktop. Setup can be deferred or resumed without creating another administrator.
- Server-backed first-app progress and an idempotent registration endpoint, preventing duplicate apps after retries, lost responses or restart.

### Fixed and hardened
- Personal desktop/icon APIs enforce ownership and current app grants, reject invalid trees/cycles and normalize uploaded raster content instead of serving originals.
- Queued window writes retain their original account epoch, and route reconciliation cannot apply an obsolete maximize state after newer navigation.
- Permanently removed app history is reclaimed before desktop admission; revoked/disabled customizations remain available for regrant. Invalid private routes do not leave a previous maximized window covering recovery controls.
- Covered intro content is inert, with managed focus and reliable Escape/Tab behavior; hidden forms cannot receive accidental interaction.
- Owner setup fragments are captured and cleared before waiting for session discovery.
- Existing accounts do not replay first-run setup. Existing preference values are preserved while new motion defaults are added; malformed persisted flags still fail closed.

This source version supports a private standalone installation. A source push alone does not deploy it or make apps public; deployment qualification and operator access remain separate steps.

## [0.2.0] — 2026-09-18

### Added
- Persistent accounts with protected first-run `admin` enrollment, administrator-created users, roles and per-app grants. No shared default password.
- Login screen informed by Wicked and Journalmax; display-name/password editing, password resets and account disabling.
- Navigation start menu with authorized apps, Profile settings, Sign out and administrator-only Control Panel.
- Users, Apps and System pages with searchable tables, focused editors, removal confirmation and readable diagnostics.
- Five-step Add app wizard: Native/Streamed, name/address/icon, options and connection tests/previews, access selection, and review/save.
- Real HTTP(S) web apps: native sandboxed frames/new tabs and isolated streamed Chromium contexts with approved origins. Existing bundled apps remain available.
- Status observations identifying the user's device or Relay, with check time and details. Per-account **Show app status** preference, enabled by default and persisted across sessions/restarts.
- Quiet version display in the desktop/login footer, Profile settings and Control Panel → System, all derived from package metadata.
- This changelog and documented versioning/update practice.

### Changed
- Quick Nav became **Navigation**; user-facing Services terminology became **Apps**. Legacy registry endpoints remain compatible.
- Profile and settings now use the original black/stone/off-white palette. Semantic color is reserved for status indicators.
- Account and app registry state persist; login sessions remain ephemeral. Layout is per user, while browser contexts are separate per login session.
- Registration no longer requires Relay-side DNS resolution; client-only native addresses and temporarily offline apps can be saved.

### Fixed and hardened
- Server-enforced grants across window operations, native routes and WebSockets; sensitive account changes revoke live access. Last-active-admin protection prevents accidental lockout.
- Salted asynchronous password hashing, bounded login attempts, finite sessions, CSRF/Origin checks and refusal to reset corrupt account state into enrollment mode.
- DNS-pinned HTTP transport and exact approved-origin checks, with metadata/self-access restrictions and a deny-only browser fallback proxy. Legitimate Tailnet destinations remain supported.
- Native initial URLs sharing Relay's authentication hostname are rejected across ports, including wizard previews and desktop launches; cookies are not port-isolated.
- Pending stream and preview/check cancellation on logout, expiry, revocation and disconnect. Slow checks/previews do not hold the account mutation queue.
- Separate fair background-health scheduling prevents larger app lists from exhausting interactive stream capacity. HTTP error responses are not labelled as an unreachable server.
- Preserved editor drafts across tabs, aligned status search with displayed labels, and fixed settings teardown when authentication expires during loading.
- Recovered persistence queues after write failures and replaced a timing-sensitive wheel-test delay with waiting for the actual scroll effect.

### Migration and compatibility
- Existing app IDs, grants and libraries are retained. Missing legacy status preferences default to enabled; stored preferences are validated.
- The old owner bootstrap-login bypass is retired. Uninitialized installs enroll an admin once; initialized installs require a password. Restart signs users out.
- Legacy `.runtime/layout.json` remains untouched but is not automatically assigned to a new user. See README for optional operator-controlled migration.
- Native app permissions control the Relay launcher, not the destination website. Use a dedicated Relay authentication hostname; native redirects and direct visits remain an administrator trust responsibility.
- Streamed upstream WebSockets, audio and file-transfer bridges, durable upstream browser logins, and universal website compatibility are not implemented. This is still a loopback development prototype, not a production deployment.

Development checkpoints included: accounts/navigation (`d171459`), neutral structured settings (`3fb1524`), and web-app wizard/status preferences (`c58c0dc`).

## [0.1.0] — 2026-09-18

Initial public source baseline (`4962fb4`).

### Added
- Hybrid Svelte desktop with movable/resizable windows, dock, saved layout and compact dotted visual style.
- Bundled native Parcels and isolated Keepsakes integrations, plus two synthetic Chromium-streamed demo apps.
- Owner-only loopback bootstrap access, authenticated HTTP/WebSocket gateway, native proxy and sandbox-enabled browser capture.
- Real ZIP-byte comparison, native upload/edit, two-stream input isolation, pause/resume/reconnect and geometry regressions; scoped local benchmark documentation.
- Public source packaging that excludes credentials, user libraries, private planning documents and uncleared reference-font binaries.

### Naming
- The project was renamed from Orbit to **Relay — Wicked Evil relay / WE relay** before this public baseline. Internal project identifiers and the folder were migrated while retaining local data.

## Maintenance

- Record each meaningful change under Unreleased while developing. Include Added, Changed, Fixed, Security or migration notes as appropriate; omit empty categories.
- When publishing a version, move those notes into a dated version entry. Use `npm version X.Y.Z --no-git-tag-version --ignore-scripts` to keep package and lockfile metadata together.
- `version.js` reads `package.json`; frontend displays and backend diagnostics must import it rather than hardcoding a version. Rebuild the frontend and restart the gateway when changing versions.
- Run the build and full suite; `tests/frontend/version.test.mjs` checks metadata, visible UI, diagnostics and changelog consistency. Keep test evidence in TEST_REPORT.md and private infrastructure history outside the public repository.
- A commit/push does not deploy, create a release tag or publish a GitHub Release. Those are separate deliberate actions.
