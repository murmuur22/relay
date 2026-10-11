# v0.6.5 compatibility retry — evidence contract, not live instructions

Immutable signed candidate source/tag: 3a13737d619cd832a29c25db3c2108a7b2c65998 / v0.6.5.
The signed payload, public assets and seven privileged broker modules must not change.

The v0.6.3 runtime has no X-Relay-Runtime-Instance. The new web correctly retires
an original monitor with HTTP401 after a restart when either runtime identifier
is missing. A hidden harness password login and launch is monitor replacement,
not uninterrupted monitoring. The proposed recovery patch was rejected by independent
review and is not integrated. Its callback also overwrites the cookie required by
a later original-session-expiry assertion; its local green polling tests missed that.

Separate bounded hosted gates:

1. Reproduce ORIGINAL wait_job failure with sanitized journal-only labels in both
   modes against signed v0.6.3 -> unchanged signed v0.6.5. Preserve nonzero status,
   cleanup, historical failed run38123967676 and actual new failed run evidence.
2. Explicit legacy-no-bootstrap signed v0.6.3 -> v0.6.5 -> matching v0.6.3 cycle.
   Every original worker assertion remains. Complete control/config/units unchanged;
   old framing DENY and original monitor semantics retained. Output explicitly says
   no bootstrap/delivery qualification. This is not silently skipping a required
   test or calling legacy observation modern monitor continuity.
3. Exact modern v0.6.4 runtime/control -> v0.6.5 -> matching v0.6.4 cycle with full
   unchanged-control no-bootstrap cycle, protected two-file web-only bootstrap,
   interruption/startup-failure restore, real signatures/readiness/consent/owner
   denials, runtime presentation and lazy assets after actual candidate deletion.
   Original wait_job remains uninterrupted; no reauthentication retry.

The supported bootstrap admission for this release is deliberately restricted to
exact signed v0.6.4 CONTROL and a separately admitted, genuinely verified modern
runtime before bootstrap; the hosted baseline is exact v0.6.4 runtime. This is the
user-authorized runtime-prerequisite alternative, not a v0.6.3-control migration.
The mandatory v0.6.3 signed runtime upgrade/paired-rollback test remains gate2.
Direct v0.6.3 runtime bootstrap, v0.6.3-control bootstrap/migration, hidden recovery,
and modern-monitor rollback into v0.6.3 are unsupported and outside acceptance.
The original failed direct-bootstrap evidence is retained, not rewritten as a pass.
A future v0.6.3-control runtime-first bridge or browser recovery needs its own
explicit compatibility contract and proof; these four jobs do not qualify it.

Runtime-first prerequisite: genuinely verified, separately qualified published
runtime >=v0.6.4 before the v0.6.5 web reader. Exact versions/control baselines
must be admitted; a numerical minimum is not blanket future-version qualification.
Rollback into v0.6.3 loses restart evidence too. Either independently prove explicit
operator browser sign-in/relaunch without mutation retry, or keep that boundary
outside modern uninterrupted monitoring and retain the separate legacy rollback gate.

Robbie's reported current v0.6.4 runtime/web meets the modern version prerequisite,
not complete live host admission or stable-release qualification. No live commands
or migration are authorized by this evidence contract. Initial web-only bootstrap
remains a later manual, explicit operator action after release and host admission.

Status: explicit narrowed compatibility contract; hosted gates pending.
Leave v0.6.5 public prerelease, latest v0.6.4 and operatorReady=false until every
required gate is genuinely resolved. If shipped browser/server changes are required,
make a new release rather than retagging/resigning/replacing v0.6.5 assets. A harness
or docs-only overlay is separately pinned and does not change shipped payload bytes.
