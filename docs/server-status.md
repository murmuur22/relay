# Relay server status (0.6.7 backend candidate)

`GET /api/status` returns only the calling account's authorized managed apps. `showAppStatus:false` returns `{}` before checks/cache reads; authority/preferences/definition are checked again after asynchronous work and before publication. Personal Native bookmarks never enter this API's probe list and remain client-only / not monitored by Relay. No arbitrary probe URL is accepted.

## Immutable target policy

Native/Streamed managed definitions are administrator-registered and already permit server transport checks under the existing registration and approved-origin policy. This slice reuses that policy, not ordinary-user URL assertions or blanket new internal-network permission. Registration remains syntax-only so offline/client-only managed URLs can be saved; actual probes resolve, vet all DNS records and pin one approved record before the socket. Metadata, link-local, unspecified and other prohibited destinations and the management self-target remain denied. Gateway checks use only the validated configured target's fixed upstream plus fixed entryPath, including its exact TLS CA/server identity policy. They never launch an app route, capture authentication, send a private jar/token, inject a mutation header, or fetch a personal URL.

Checks are bounded HEAD requests. Redirect HTTP responses are observations, not followed connections: no redirect hop is silently fetched. A future follow implementation must vet/pin and reauthorize every hop. No body is buffered for HEAD. Each pool permits four active checks and at most64 active/queued entries, five-second completed caching, bounded128 cache entries and32 pending observers per key. The existing transport imposes a2500ms overall deadline and DNS deadline, and24 pending request cap. Native/Streamed and Gateway pools are separate from interactive traffic. Coalesced observers retain independent live authority; losing one observer cannot cancel another. Cache identity includes a bounded per-definition runtime edit epoch (so change-and-change-back cannot revive an old result), the complete managed definition or Gateway target/definition and is discarded with the Gateway configuration generation. Old definitions cannot publish as new observations. This is polling reachability, not an uptime database or background monitor when no authorized client asks.

## Response

Each app key has existing `state`, `source:'relay'`, `checkedAt` (Unix milliseconds), and non-secret `detail`. Network observations additionally have `reachability`, `reason`, `authRequired`, and actual `httpStatus` only when received. No upstream address, custom CA, credentials or private route observation is disclosed.

- `reachability:'responding'`: actual response. HTTP200 retains legacy `state:'Online'` but means only Server responds, not business readiness or successful login.
- HTTP401/403: `state:'Reached'`, `reason:'auth-challenge'`, `authRequired:true`. Display Server responds — authentication required, not Offline.
- HTTP5xx: `state:'Reached'`, `reason:'http-server-error'`; response received with a warning, not transport down.
- HTTP3xx: `reason:'http-redirect'`; target not followed.
- `reachability:'unreachable'`, `state:'Offline'`, `reason:'no-http-response'`: no bounded server response. Device connectivity can still differ.
- `reachability:'unknown'`: policy/admission/observer failure, not an assertion that the app is down.
- Gateway unavailable: `reachability:'not-monitored'`, `state:'Unknown'`, no measured timestamp. Personal bookmarks are omitted entirely; frontend should say Not monitored / client-only, never orange Unknown as a server failure.

Bundled runtime/synthetic demos retain their existing readiness semantics and may lack new network fields. No iframe load/error or failed device CORS check is promoted to server health. A successful app-origin browser visit remains a separate observation and must not overwrite this server source.

## Atomic desktop API companion

`POST /api/desktop/move` takes exactly required `revision`, `sourceParentId`, `itemIds` (1–128 unique visible owner siblings), `parentId`, with optional `slot`. Items ordered by old slot then ID occupy consecutive vacant destination slots; omitted slot chooses the first free consecutive run. Explicit collisions, stale source/revision, self/descendant targets, foreign/revoked/unknown members and duplicate IDs reject the whole batch. This deliberately does not implement the proposed two-dimensional `anchorId`/`rows` contract; clients must not send those fields.

`POST /api/desktop/sort` takes exactly `revision`, `parentId`, `by:'name'|'type'`. It changes only visible item slots in that folder. Hidden/revoked slots are reserved. Name ties use NFKC lowercase, exact label, then ID; Type groups Folders, Native, Streamed, Gateway, System before name ties. Each operation is one owner-scoped serialized read/modify/validate/atomic-rename, never a loop of PATCH calls. Responses are full desktop snapshots; unchanged sorts may retain revision. HTTP409 requires refresh and explicit retry, not replay with a newer account's credentials.

All custom labels, builtin/upload icons, private bookmarks and retained revoked placements/grants remain unchanged except requested slots/parents. Complete owner state is validated before/after edits. No root rename or filesystem path is accepted. Default folder icon now resolves to existing `pixel-folder`; Control Panel uses `pixel-monitor`, Updater `pixel-git-branch`. Explicit appearance overrides, including legacy icons, are not rewritten. Parent owns frontend SVG rendering, keyboard/touch actions, shared changelog/version and final release qualification.
