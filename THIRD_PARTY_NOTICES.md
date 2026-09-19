# Source and dependency notices

Relay (Wicked Evil relay / WE relay) is licensed under the MIT License; see the repository's `LICENSE` file. This covers Relay and its first-party code in this repository. Third-party dependencies retain their own copyrights, licenses and required notices.

## First-party integrations

- Parcels: https://github.com/murmuur22/parcels — snapshot commit recorded in `integrations/provenance.json`.
- Keepsakes: https://github.com/murmuur22/keepsakes — snapshot commit recorded in the same manifest. Native URLs are adapted for the gateway; data libraries are not included.
- Visual reference: https://github.com/murmuur22/wicked at `ee337dfb600afb454b36a8e4fd59187297b1dd4d`. Relay recreates the desktop interaction/visual approach rather than importing its deployed service configuration.

These are separate projects by the repository owner. The MIT grant covers the first-party code distributed in this Relay repository; this change does not edit or select licenses for the separate upstream repositories.

## Dependencies

Node and Python dependency versions are recorded in lockfiles. Installed packages retain their respective license notices. The desktop and independent updater both use Three.js 0.186.0; its MIT notice is included in each built bundle under `licenses/three.txt`. Parcels also includes redistributable library notices under `integrations/parcels/public/licenses/` for Three.js and fflate. Chromium is installed by Playwright for source checkouts; Linux release payloads include the matching Chromium runtime and its bundled notices under `browsers/`. The standalone server release excludes the development-only first-party integrations and private reference fonts.

## Fonts and local artifacts

Reference font binaries are excluded until redistribution rights are verified. Fresh checkouts render with system fallback fonts. Private planning PDFs, agent working notes, runtime credentials, personal libraries, generated screenshots and local environments are also excluded from Git.
