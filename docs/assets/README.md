# README logo provenance

`readme-logo.png` is an opaque light-background derivative of the existing
`apps/dashboard/public/logo.png` mark. It is used only by the repository README;
the primary dashboard asset remains unchanged. The light tile keeps the dark mark
visible in both GitHub themes without relying on CSS supported only by the dashboard.

- Generated on 2026-09-08 with the built-in `image_gen` tool in edit mode.
- Input: `apps/dashboard/public/logo.png`, inspected before the edit.
- Generated source: `/home/user/.codex/generated_images/01a07de8-ccb6-7e81-93fa-2c4494be777e/exec-4f720edc-e7e5-4aa5-a81f-ee0f4fc78207.png`.
- Generated output: 1254 × 1254 opaque PNG. The generator did not honor the requested
  smaller dimensions.
- Committed file: that output resized to 240 × 240 with Pillow (Lanczos) on 2026-09-09,
  displayed at 120 × 120 in the README so it stays crisp on 2x displays. No other pixel
  edits.
- Visual review confirmed the existing mark's geometry and legibility on the light
  tile. This is a generated derivative, not a claim of pixel-identical foregrounds.

## Edit prompt

> Use case: precise-object-edit. Edit target: the attached existing AgentCommons logo PNG. Primary request: change ONLY its transparent background to a completely opaque, flat, very light cool neutral background (#F5F7FA), creating a clean square README logo tile legible on both white and dark GitHub pages. Preserve the existing dark near-black geometric mark EXACTLY: same outline, same proportions, same rounded strokes and cuts, same placement; do not redraw or reinterpret the brand, add text, add shapes, add shadows, gradients, texture, borders, or watermarks. Keep the original square composition and padding. The light background must fill every pixel outside the unchanged logo, including the corners; no alpha transparency. Output a small clean PNG intended for 96–128 pixel display; use 512x512 or smaller if supported, and a compact file. This is a background replacement, not a new logo design.

# README screenshots

`screenshots/*.png` are captures of the built dashboard served by the browser fixture
(`apps/dashboard/scripts/browser-server.mjs`, a disposable PostgreSQL and ClickHouse
pair with the real API). The fixture organization was seeded through the public API with
27 sessions from Claude Code, Codex, Gemini CLI and pi for three example members
(`*@example.com`, one promoted to admin) across four example repositories, including one
Claude Code session with an `Explore` subagent run and ten sessions that read earlier
sessions through the API while live. Captured on 2026-09-09 with Playwright Chromium at
1440 × 900 and a device scale factor of 2, once with `agentcommons-theme=dark` and once
with `light`. Home and Sessions are captured as the admin; the session page, SQL and
Install as a member. Every image is a viewport capture cut at the last element boundary
that fits (a tile row, a table row, an install step) except the session transcript, which
is a full-page capture cut after the expanded subagent run. Images are scaled to 2000 px
(Home) or 1600 px wide and quantized to 256 colours with Pillow. The Install capture
proxies the fixture behind the example hostname `agentcommons.acme.dev` so the command
shows a deployment-style origin instead of a local port, and the chosen key's secret is
masked in the page before capture. The README selects the dark or light file with a
`<picture>` element.
