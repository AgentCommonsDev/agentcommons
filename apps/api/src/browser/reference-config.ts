import { config } from "zod/v4/core";

// Scalar's bundled Zod shares the official global configuration. Set CSP-safe
// validation before loading it, so even its optional eval feature probe is avoided.
config({ jitless: true });
