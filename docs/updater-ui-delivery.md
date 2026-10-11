# Runtime-delivered independent updater presentation

## Delivery boundary

Starting with the 0.6.5 candidate, the normal signed Relay runtime archive also
contains a separately built, first-party `updater-presentation/` browser bundle.
Its inert `presentation.json` binds the canonical version, web API compatibility
number and complete relative file inventory by size and SHA-256. This is not a
new release-manifest field or executable migration hook. The existing protocol-1
manifest and signed runtime artifact remain the old engine's only runtime inputs.

The root broker's seven modules are unchanged from 0.6.3 and 0.6.4. Runtime
updates still cannot replace the installed web API, broker, key, configuration,
identities or systemd units. No privileged control-plane self-updater is added.
Ordinary desktop styling remains neutral; only updater surfaces use the licensed
technical fonts, monochrome percentage and genuine shaded knot.

The independent unprivileged web service reads the fixed protected installation
at `/opt/relay`, never a root or URL supplied by a browser, credential or metadata.
An eligible current runtime supplies the document at `/updater/`; the one-use
launch path remains `/updater/#ticket`. API requests remain `/updater/api/` and
the exact management frame ancestor, Origin, original-owner cookie, independent
CSRF and fresh-password consent rules remain in force. This is trusted first-party
code from the normal verified installation, not a plugin loader.

## Existing installations versus fresh installations

Fresh 0.6.5 installations receive the bridge in the separately attested updater
archive. No extra broker opcode, root writer, configuration field or unit is
needed. An already installed 0.6.4 web server cannot learn this reader merely
because its runtime is updated. Existing installations need one explicitly
operator-controlled, web-service-only bootstrap from the verified 0.6.5 updater
archive. The runtime may be updated first, or the bridge bootstrapped first with
its old built-in fallback; the old engine still installs only the normal runtime.
See [narrow bootstrap and restore](updater-ui-delivery-bootstrap.md) for the exact
supported baseline and qualification status. Never reuse the fresh installer to
adopt an existing installation. Production inspection/maintenance is not performed
by release publication or disposable qualification.

After bootstrap, subsequent compatible signed runtime presentations are selected
on the next document load without restarting the web service or broker. An already
loaded console deliberately keeps its original frontend bytes and polls the same
independent API. It does not hot-execute new code mid-session or retry a mutation.
The native desktop's read-only updater view is part of the usual desktop bundle.

## Selection, fallback and immutable pins

Only the trusted current link to an installed protected release is eligible.
The runtime package version must agree with the explicit descriptor. Files are
bounded ordinary single-link files; untrusted ownership/write permissions, links,
special types, duplicate or unlisted paths, wrong sizes/hashes and incompatible
schemas are refused. Missing, old, malformed, incompatible or unavailable runtime
presentations select the independently installed built-in UI instead. The fallback
is not an engine-version claim or a destructive upgrade gate.

The entire small presentation is validated and copied into an immutable in-memory
pin before its index is served. Version-specific URLs such as
`/updater/presentation/v0.6.5/assets/index-CONTENTHASH.js` resolve only those
complete pins, not mutable current code, failed candidates or a runtime being
stopped. Unknown paths never provide filesystem browsing. Deferred Three.js and
font requests therefore survive current-link switching, candidate cleanup and
matching-state rollback for documents served by that same web process.

Budgets are 64 presentation files, 4 MiB per presentation, eight pinned versions
and 32 MiB of retained frontend bytes per process, plus bounded descriptors and
package metadata. Loading is single-flight with explicit path/depth/entry/time
bounds. No pin is evicted while the web process is alive: after capacity is
reached, a new unpinned version uses the built-in UI rather than breaking existing
monitors. There is no new writable cache, disk retention or admission lock.
Existing independent-session admission remains 64 sessions (actual Relay login
limits remain separate); pins are shared by version, not copied per session.

A deliberate operator web restart discards the pins and sessions. Close monitors
before bootstrap/restore/restart and reopen them afterward. Retention is not a
whole-page offline promise, a cross-restart cache or an unlimited number of
historical frontend versions. Runtime readiness still belongs to the old engine;
UI compatibility does not override readiness or authorize rollback. Code rollback
must restore its matching state through the normal independently authenticated
engine, not just move a symlink.

## Evidence tiers

Source descriptor/archive tests and malicious filesystem fixtures establish
bounded source behavior. Compiled Chromium tests use genuine disposable Relay
authentication and actual HMAC fixture engine transfers/readiness-failure rollback;
HMAC evidence is not GitHub attestation. Route-mocked design screenshots are
explicitly synthetic. A WebKit no-WebGL/font/layout result is a fallback tier,
not physical Safari/GPU qualification.

Official anonymous manifest/bundle verification and the hosted Linux/systemd
fresh-install, old-engine signed runtime upgrade/rollback and web-only bootstrap
are separate publication gates. Consult `TEST_REPORT.md` and the exact hosted
runs for executed results; this architecture document alone asserts no completed
signed gate, production deployment, reboot/power-loss or Internet-load test.
