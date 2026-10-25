# Backend integration status

Entry point: `server/index.mjs`. Gateway, native proxy and stream manager live in `server/gateway.mjs`, `server/native.mjs` and `server/streams.mjs`.

In the default development profile, listeners are 127.0.0.1:4180 for the gateway and 127.0.0.1:4181 for the isolated native backend. First enrollment uses the protected one-time `.runtime/setup-url.txt`; never print or publish that credential. After enrollment, `.runtime/open-url.txt` opens the ordinary password login. Restart does not bypass authentication.

Development native URLs are `/native/parcels/` and `/native/keepsakes/`; standalone mode does not install or start those integrations. Base-path adaptations are confined to the bundled source. Same-origin native integrations are trusted first-party apps, not an untrusted-plugin boundary. Notes Lab and Signal Lab are synthetic streamed fixtures; administrators can also register bounded HTTP(S) Native/Streamed apps and select configured Gateway targets. These are distinct modes, not an arbitrary-URL proxy; see [web-app boundaries](web-apps.md), [gateway deployment](gateway-deployment.md) and [standalone installation](../deploy/README.md).

See `TEST_REPORT.md` for current verified behavior and known follow-ups, and `docs/benchmark-results.md` for bounded local streaming measurements. This is a development prototype, not a production service.
