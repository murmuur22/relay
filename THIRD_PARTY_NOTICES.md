# Source and dependency notices

Relay (Wicked Evil relay / WE relay) is licensed under the MIT License; see the repository's `LICENSE` file. This covers Relay and its first-party code in this repository. Third-party dependencies retain their own copyrights, licenses and required notices.

## First-party integrations

- Parcels: https://github.com/murmuur22/parcels — snapshot commit recorded in `integrations/provenance.json`.
- Keepsakes: https://github.com/murmuur22/keepsakes — snapshot commit recorded in the same manifest. Native URLs are adapted for the gateway; data libraries are not included.
- Visual reference: https://github.com/murmuur22/wicked at `ee337dfb600afb454b36a8e4fd59187297b1dd4d`. Relay recreates the desktop interaction/visual approach rather than importing its deployed service configuration.

These are separate projects by the repository owner. The MIT grant covers the first-party code distributed in this Relay repository; this change does not edit or select licenses for the separate upstream repositories.

## Dependencies

Node and Python dependency versions are recorded in lockfiles. Installed packages retain their respective license notices. The desktop and independent updater both use Three.js 0.186.0; its MIT notice is included in each built bundle under `licenses/three.txt`. Parcels also includes redistributable library notices under `integrations/parcels/public/licenses/` for Three.js and fflate. Chromium is installed by Playwright for source checkouts; Linux release payloads include the matching Chromium runtime and its bundled notices under `browsers/`. The standalone server release excludes the development-only first-party integrations and private reference fonts.

Gateway hostname validation uses the pinned MIT-licensed `tldts` and `tldts-core` packages and their bundled Public Suffix List data. Their upstream license notices remain in the runtime's packaged `node_modules`; the dependency lockfile records exact versions. This distinguishes private hosting-provider suffixes from an administrator's own delegated namespace without maintaining a Relay-specific suffix blacklist.

## Fonts and local artifacts

Private reference font binaries remain excluded; the rest of the desktop still uses system fallbacks in fresh checkouts. Only updater surfaces bundle **Silkscreen Bold** (Copyright 2001 The Silkscreen Project Authors) and **Share Tech Mono Regular** (Copyright 2012 Carrois Type Design), both under **SIL Open Font License 1.1**. Original upstream licenses are preserved byte-for-byte as `silkscreen-OFL.txt` and `sharetechmono-OFL.txt` in both public license directories and built bundles. `updater/ui/src/assets/font-sources.json` records the pinned google/fonts commit, original TTF/license URLs and SHA-256 values, full-font WOFF2 conversion tooling and output hashes; the same record ships as `licenses/updater-font-sources.json`. These are freely redistributable upstream fonts, not the historical proprietary/local reference assets. No external font request is made at runtime.

Private planning PDFs, agent working notes, runtime credentials, personal libraries, generated screenshots and local environments are excluded from Git.
