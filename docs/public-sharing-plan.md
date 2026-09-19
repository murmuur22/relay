# Public sharing — proposal, not implemented

The current desktop URLs are private, account-scoped navigation. A readable path or maximized app link does **not** grant access and must not become public by removing the gateway's authentication check.

## Recommended progression

### 1. Publish one app

An administrator creates a separate publication record with a readable alias such as `/s/demo-notes`. It references an allowed registry app, an explicitly chosen public title/icon, an exposure mode and a revocation policy.

Visitors see that app, usually maximized. They do not receive the owner's desktop tree, other app names, private icon assets, Control Panel data or browser session. Private IDs and desktop paths are not publication credentials.

This is the smallest useful first sharing feature. Start admin-only; a later capability can let ordinary users request or create publications only for apps administrators explicitly mark publishable.

### 2. Publish a curated collection

A publication can contain an explicit subset of apps and public folders, with its own public presentation. Options might be:

- **Single app:** no exploration beyond that app.
- **Shared desktop:** visitors can browse only the curated collection.
- **Restricted collection:** sign-in/invite is required for selected entries.

The server returns only entries permitted by the publication and visitor's authorization. Hiding private entries in the UI is insufficient. New private apps must not become public automatically when added to an owner's folder. Public names/icons should be chosen deliberately rather than silently copying private personal labels or uploaded assets.

### 3. Invitations and delegated publishing

Possible access policies: public, Relay-account-only, or revocable invitation/password access. Use bounded guest sessions and hashed invitation credentials, with expiry and revocation. Anonymous visitors must never inherit an administrator's upstream browser cookies or privileges.

A user's ability to open an app does not automatically include permission to publish it. Delegation needs a separate administrative capability and clear ownership/audit rules.

## Native and streamed publication are different

**Native:** the visitor's browser must reach the upstream app. A private LAN address does not become Internet-accessible because Relay lists it. Suitable options are hosting an app's static assets on an approved public app origin, or deliberately configuring a separate upstream reverse proxy with its own authentication and cookie boundary. Browser-only tools such as Parcels are a useful first candidate; this does not create a file-download portal or server upload store.

**Streamed:** the visitor reaches Relay's public streaming entry, while a dedicated isolated browser reaches the configured upstream app. Use a separate guest context per visitor/publication, exact destination restrictions, quotas, idle expiry and least-privilege upstream identities. Never lend visitors an already-authenticated owner/admin session. Pixel streaming does not remove the powers of the upstream account.

Current streamed WebSocket/audio/file-transfer limitations still apply. General website compatibility and production network isolation require separate qualification.

## URL and deployment design

Keep private navigation and public publication routes separate. A private example is `/desktop/work--<stable-key>?app=notes--<stable-key>&view=maximized`; a publication might use `/s/demo-notes`. The public alias resolves a server-side publication record, not arbitrary upstream URL parameters.

Use a dedicated authentication hostname for the private control plane and a separate public presentation hostname where practical. Cookies are not port-isolated. Public native content must not share the private authentication origin. Configure HTTPS, trusted reverse-proxy handling and explicit allowed hosts/origins; do not weaken today's loopback checks globally.

A request to publish specific raw API endpoints would be a **separate adapter** with explicit path/method/authentication rules, not unrestricted URL forwarding. Sharing a desktop app page and proxying an upstream API are different features.

## Gates before public exposure

- Separate guest permissions, cookies, app data and browser contexts from private accounts.
- Reserve private-owner capacity; public traffic must not exhaust the same browser/session pool.
- Bound connection rates, concurrency, memory, idle time and outbound destinations; enforce OS/container network policy in addition to browser routing.
- Revoke guest sessions/streams when publication access changes. Avoid leaking private existence through errors or breadcrumb/catalog responses.
- Define minimal audit records without logging typed passwords, session credentials or private page content.
- Test with synthetic public fixtures and hostile requests before exposing real household services.

No public endpoint, guest browsing, invitation flow, DNS change, reverse-proxy deployment or access-policy relaxation is implemented by this proposal.
