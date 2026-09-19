# Motion and first-run setup

## Arrival and interface motion

The short monochrome introduction is decoration, not a machine boot or security check. The literal prompt **[ESC] BYPASS INITIALIZATION** is a focusable text button: Escape, click and tap dismiss it immediately. No F12 override, sound, simulated diagnostic logs or hidden administrative shortcut is added.

Authentication discovery runs underneath the introduction, but covered controls are inert. Focus stays on the bypass control and returns to login/setup/desktop when the overlay ends. The introduction sits above desktop chrome. Its seen marker is scoped to the browser tab's session; storage failures are handled without stranding the user.

After sign-in, login fades away and desktop icons/dock resolve. Windows have short entrance, minimize and restore effects; Navigation has a small slide. Drag/resize geometry is not interpolated. Minimized native iframes stay mounted, retaining their forms, while hidden windows are inert. Logout/revocation removes protected UI immediately rather than waiting for an outgoing desktop animation.

## Preferences and accessibility

**Profile → Intro animation** and **Interface animations** are independent account preferences. Like Show app status, updates use authenticated, CSRF-protected partial preference writes and preserve other choices. Device `prefers-reduced-motion` takes priority and is observed at runtime.

Before authentication, Relay does not know which account will sign in. It can use only the device's reduced-motion setting and the last locally cached motion booleans. A new device uses defaults; after authentication, account preferences take precedence. No identity, password or setup credential is put into that motion cache.

Reduced motion suppresses intro movement and action-based interface motion. The login fade is brief and starts only after a successful authentication response. Motion is not a substitute for real loading/error states and never changes permissions.

## First-time administrator flow

1. Open the protected local setup link and choose the initial admin password. The setup fragment is captured and removed from the address bar before network discovery completes.
2. Add a real first app through the existing Native/Streamed wizard, or choose **Set up later**.
3. Enter the desktop.

The password is committed independently of the optional app step. Reloading, signing back in or restarting resumes pending setup rather than creating another administrator. Existing accounts migrate as onboarding-complete and are not forced through this flow.

`POST /api/onboarding/app` uses the same app validation and atomic grant handling as normal registration, but records `onboardingAppId` with the first app in the same account-state mutation. Repeated/concurrent submissions and a retry after a committed response was lost return the same saved app. After reload, the UI reconciles persisted progress instead of registering another app. Deliberately removing that app clears its marker while setup is pending.

`POST /api/onboarding/complete` marks only the current administrator complete. Both endpoints require normal authentication, exact Origin/CSRF checks, active admin authority and no forced-password-change state. Bypassing the intro cannot call or bypass them. Onboarding state is UX progress, not an additional permission system.

## State migration and rollback

Existing preferences retain their values; missing intro/interface fields default to enabled. Malformed fields remain rejected. New administrator-created users are onboarding-complete; only initial enrollment starts the owner setup sequence.

Back up protected `.runtime` state before adopting the update. Older source versions reject the expanded preference keys, so rolling back source may also require the matching pre-update runtime backup. User app libraries are not moved or reset by this update. Never publish those backups or enrollment credentials.

## Verification boundary

Tests use temporary accounts and local synthetic apps, including intro input isolation, once-per-session behavior, keyboard bypass, reduced-motion changes, real window state, first-app retries/restart and authorization. The optional recording under `screenshots/relay-immersive-demo.webm` shows an actual synthetic browser flow, not a real household deployment. See TEST_REPORT.md for executed results. No live VM deployment or general accessibility/physical-device certification is implied.
