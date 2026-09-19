# Backend integration status

Entry point: `server/index.mjs`. Gateway, native proxy and stream manager live in `server/gateway.mjs`, `server/native.mjs` and `server/streams.mjs`.

Default listeners are 127.0.0.1:4180 for the gateway and 127.0.0.1:4181 for the isolated native backend. Access uses the protected one-time `.runtime/bootstrap-url.txt`; never print or publish that credential.

Native URLs are `/native/parcels/` and `/native/keepsakes/`. Base-path adaptations are confined to the bundled source. Same-origin native integrations are trusted first-party apps, not an untrusted-plugin boundary. Streamed pages are fixed synthetic fixtures, not arbitrary URL launchers.

See `TEST_REPORT.md` for current verified behavior and known follow-ups, and `docs/benchmark-results.md` for bounded local streaming measurements. This is a development prototype, not a production service.
