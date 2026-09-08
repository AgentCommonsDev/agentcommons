# 0022. Bound metadata previews as well as transcript content

Date: 2026-09-08 · Status: accepted

A real PostgreSQL read test inserted valid message metadata below the raw-record
size limit. A long model, tool name, tool identity, or agent identity made `get`
return `MESSAGE_METADATA_TOO_LARGE`; the same data could prevent search pagination.
Bounding only message content and the session header did not guarantee usable reads.

Use one metadata-preview helper in the read services. Search block title, model,
repository, and branch fields, search message tool fields, and `get` message tool,
model, and agent fields are bounded to 256 UTF-8 bytes, including an ellipsis when
shortened. Each affected object exposes `truncated_fields`; the shared text formatter
and dashboard make the shortening visible. Stable database IDs are never shortened.
Stored values are unchanged and remain available through raw records and SQL.

This follows the existing bounded session-header contract. Content continuation and
search cursors keep their existing meaning. Tests include multibyte characters and
JSON-escaped metadata and verify both structured and text response budgets.
