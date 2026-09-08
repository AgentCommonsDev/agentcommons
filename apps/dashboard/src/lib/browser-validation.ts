import { z } from "zod";

// Run before browser schema imports: strict CSP forbids Zod's optional eval probe.
z.config({ jitless: true });
