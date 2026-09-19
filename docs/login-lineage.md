# Login and shared-desktop design references

The account update follows the first-party visual lineage rather than adding a generic dashboard UI.

## Wicked

Source inspected: https://github.com/murmuur22/wicked/tree/master/src/routes/login

The login page centers a simple light rectangular panel over a black/stone dotted background. Username/password fields, direct labels and a dark submit button keep the entry flow small. Relay retains the dotted desktop context, compact borders and quiet maker credit. Reference images/fonts are not copied into the public source.

## Journalmax

Source inspected: https://github.com/murmuur22/journal-maxx/blob/main/templates/login.html

The login template uses minimal identity/passphrase fields, an ENTER arrow, appropriate autocomplete attributes, and explicit invalid/expired/throttled feedback. Relay borrows clarity of interaction, not Journalmax's branding or a claim to its optional one-time-code support.

## Shared desktop

Navigation is the user's start menu: authorized applications, profile, sign out, and an administrator-only Control Panel. Service assignment is a server-enforced permission, not just icon visibility.

For streamed services, the visitor connects to Relay while Relay connects upstream. The administrator decides what the chosen upstream application and its account may expose. Streaming does not remove upstream privileges or make it safe to share a host-administration session. A single desktop URL is an access point, not a substitute for network policy or application authorization.
