# Web apps and connection boundaries

## Add an app

An administrator opens **Control Panel → Apps → Add app**:

1. **Browser location:** Native runs in the visitor's browser; Streamed runs in Relay's isolated Chromium.
2. **Name and address:** enter a label, explicit HTTP(S) URL (including any port/path) and an icon. Bare IPs require the administrator to choose `http://` or `https://`. URL credentials and fragments are rejected. Do not place secrets in query strings.
3. **Options and connection:** Native can open in a sandboxed desktop window or a new tab. Streamed apps can have additional exact approved origins. Test and preview are explicit actions; cancelling a check/preview aborts its request. Failed checks are not proof that the address is unreachable from every device.
4. **Access:** select active users. Administrators have access to enabled apps. Creation and selected grants are saved together.
5. **Review:** saving registers a launcher/configuration; it does not install an upstream application. The address need not be resolvable or online from Relay merely to save it.

Existing bundled integrations, app IDs and grants carry over. The internal registry storage and `/api/admin/services` compatibility endpoints remain; the interface and new `/api/admin/apps` aliases use Apps terminology.

## Native apps

The visitor's browser directly contacts the address. Relay cannot grant network reachability or bypass an upstream login. Relay permissions govern the launcher, not direct visits to the destination.

Desktop frames deliberately use `sandbox="allow-scripts allow-forms"`, without same-origin privileges, and `no-referrer`. This can prevent storage, sign-in and JavaScript features even when the site otherwise embeds. X-Frame-Options, CSP frame-ancestors, mixed content and browser privacy restrictions may also block embedding. **Open in new tab** is the explicit fallback, with `noopener noreferrer`; administrators can select **New tab** during registration or edit **Open in** later to make it the default. Relay does not strip embedding headers, relax the sandbox or proxy external native pages onto its trusted origin. A site sending `X-Frame-Options: SAMEORIGIN` (including Google's observed native response) is not made embeddable by Relay.

Relay cannot safely inspect or control a cross-origin native iframe's navigation history. Native windows therefore do not offer fake Back/Forward controls. Use the site's own navigation or open it in a tab for normal browser history. A blank frame is not evidence that the site is offline.

### Authentication hostname isolation

Cookies are scoped by hostname, not port. A native app on Relay's exact hostname at another port could receive the Relay session cookie. Such native registrations and launches are rejected. Use a separate hostname for the app or select Streamed. Tests use separate loopback hostnames, not a test-only authentication exception.

Before production, give Relay a dedicated authentication hostname with host-only Secure cookies over HTTPS. Do not run untrusted services on that hostname at other ports. Direct browser visits and upstream redirects cannot be comprehensively policed by a native launcher; an administrator must choose trusted destinations and maintain that hostname separation. Loopback development still assumes a trusted machine. This safeguard is not a claim that arbitrary malicious native websites are isolated from every browser/network capability.

## Streamed apps

The visitor reaches Relay; Relay's browser reaches the app. Each login/app has a separate browser context and ephemeral cookies. Existing stream limits and session revocation apply. No shared upstream credentials, durable browser profiles or automatic sign-in are supplied.

HTTP(S) browser requests, connection checks and screenshot previews use validated transport. Requests are restricted to the starting origin and explicit additional origins (exact scheme, host and port). Wildcards remain deferred. Each actual connection resolves DNS, vets the results and pins the chosen address into the socket lookup while preserving Host/TLS server-name verification. The transport never automatically follows a redirect. Streamed pages and previews use Chromium Fetch interception at every HTTP redirect hop: the destination must pass syntax/origin checks and fresh DNS vetting/pinning before connection. Chromium commits the real destination URL and retains its normal redirect method, cookie, CSP and origin rules; destination HTML is never substituted under the initial URL. RFC1918 LAN and legitimate Tailnet addresses are allowed; metadata/link-local/multicast/unspecified and prohibited transition addresses, and Relay self-access, are rejected.

Registration addresses remain limited to 2,048 characters. Runtime request/redirect URLs allow up to 32,768 characters for legitimate generated asset URLs, with the same protocol/credential/network/origin restrictions. Each chain allows at most ten redirect hops and fifteen seconds overall (each request at most five seconds), eight active requests per page and 128 retained redirect-chain records. Completed, failed and expired chains release their records. Existing transport request-body, response-body and global-concurrency bounds remain in force. Unsupported/unintercepted browser targets still fail closed through the deny proxy.

### Stream navigation and recovery

Back/Forward buttons control the remote page's actual Chromium history, including same-document navigation, not the Relay desktop address. State is sent over the authenticated stream without exposing history URLs, titles or query strings. Closing the stream or losing its ephemeral context loses that history. There is no arbitrary target-URL navigation API.

`POST /api/windows/:id/navigate` accepts only `{ "direction": "back" }` or `{ "direction": "forward" }`; reload uses the existing empty-body `/reload` endpoint. Authentication, exact Origin, CSRF, session-owned windows and app grants apply. One navigation action per page is admitted at a time, with a ten-second navigation timeout. Navigation/reload do not hold the persistence queue, so logout, revocation and close can cancel work; authority is checked again before replying.

A failed or policy-blocked main-page navigation keeps the stream recoverable and displays a static, query-free error notice. Back returns to available history; Reload retries the current page, including an initial-load failure. Receiving an HTTP error/challenge page is not transport failure: the site's response remains visible. Google and other sites may still refuse automated browsers, demand additional exact origins, or present anti-bot challenges; Relay does not bypass them.

The Chromium sandbox stays enabled. Service workers are blocked. Popups and WebSockets are blocked; downloads/file-transfer bridges and audio transport are not implemented. A private deny-only proxy and resolver restrictions prevent an unintercepted browser request from becoming an unrestricted fallback connection. These controls are application-layer defenses, not a substitute for an OS/container network policy in a hostile production deployment.

Some sites need extra asset or authentication origins; approve only those required. TLS verification remains on, so untrusted self-signed upstream certificates will fail. Sites requiring WebSockets, popups, rich browser integrations or large transfers may not work. JPEG desktop streaming is not a general media-streaming platform.

Admin previews are bounded, temporary browser sessions. Cancellation, client disconnect and session expiry must abort them. Background health checks have separate, bounded scheduling so a large app list does not consume interactive stream capacity. Closing/revoking an opening app aborts pending navigation as well as an established stream.

## Status and preferences

- A successful, readable credential-free CORS check may establish **Reachable from this device** for native apps. Browser-policy failures are inconclusive, not Offline.
- Server observations explicitly say **from Relay**. HTTP response details distinguish a responding server/application error from failure to obtain a response. A HEAD rejection or auth requirement is not proof of an outage.
- Hover or focus the icon for source, check time and detail. Results are observations, not continuous uptime guarantees or proof of a fully working authenticated app. An iframe load event is never used as health evidence.
- **Profile → Show app status** defaults on. It is saved per account and shared across sessions. Off hides dots/status text and skips that client's status checks, but leaves access permissions and other users unchanged.

## Tested scope

Use `npm run build && npm test`. Tests use local fixture HTTP sites and temporary accounts/libraries, including native tabs/frames, real streamed input, cookie separation, DNS pinning, blocked destinations, preview/cancellation, app grants and persisted preferences. See `TEST_REPORT.md` for executed results. No real Journalmax/home-service connection, production exposure, Safari qualification or unrestricted Internet compatibility is implied.
