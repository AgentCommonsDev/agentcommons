The Cal browser test loads the official embed script captured from
https://app.cal.com/embed/embed.js on 2026-09-08. The script reports version 1.6.0
and fingerprint `7ac034e5`. Its SHA-256 is recorded by the test. `CAL-LICENSE`
comes from the upstream `packages/embeds/embed-core/LICENSE` (MIT).

The test substitutes only the remote event page with an explicitly labeled local
provider fixture. It emits the official script's observed `CAL:<namespace>:<type>`
messages (`__iframeReady`, `linkReady`, and `__dimensionChanged`). This exercises
the installed React component, official bootstrap, CSP, iframe creation and mobile
layout. It does not represent a live calendar or make a booking.
