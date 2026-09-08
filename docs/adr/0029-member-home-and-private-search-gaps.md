# 0029. Member Home uses canonical reuse and private search gaps

Status: accepted

## Context

Every member needs a first screen showing whether the organization's session history is
being reused. Session detail and Status already derive reuse from successful key reads
during active session windows. A second Home definition would produce conflicting counts.
Zero-result queries can contain private session details, so an organization-level gap
screen must not expose everyone's search text to other members.

## Decision

Home reads the existing weekly and member-impact views. Weekly rows cover the current UTC
ISO week and seven preceding weeks; empty denominators remain null. Incoming/outgoing
activity and session-detail reuse share one repository query and bounded keyset cursor.
The current-week feed deduplicates source/target pairs by their latest successful read.
Member impact and personal incoming/outgoing feeds cover all retained visible history.

Repository gaps are repositories with captured sessions and no outgoing reuse. This is
the same direction as the weekly numerator: sessions whose agents read prior work. Both
ends must remain visible and nonpurged; hiding a target can therefore create a visible gap.

Zero-result searches are visible only to their author, including for organization admins.
Reader transactions set a trusted `agentcommons.user_id` alongside the organization; a
security-barrier view requires both settings. Missing identity returns no personal rows.
The existing SQL guard prohibits reading or changing transaction scope. Both settings
expire on transaction completion, including when a pooled connection changes callers.

Every Home list uses server sorting, filtering, pagination and the shared CSV envelope.
Reuse lists filter by reader identity; repository/search gaps filter literal text. Gap
previews use the existing 256-byte metadata formatter. Cursors retain bounded sort values
and stable IDs, rather than offsets, so hiding or deleting the preceding row does not skip
the next visible row. Search rows use their audit UUID; repository rows use PostgreSQL's
SHA-256 digest of the full repository name. Full redacted source text remains stored.

## Evidence

`apps/api/test/home.integration.test.ts` exercises real native keys, ingest, search/get
audits, member/admin/foreign organization reads, reused pool scope, author-only SQL,
privacy and purge changes, keyset continuation, large metadata, literal filters, CSV,
and audit failure before response. Dashboard tests exercise Home at phone and desktop
widths in both themes alongside the existing route matrix.
