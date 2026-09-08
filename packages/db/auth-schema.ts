import { betterAuth } from "better-auth";
import { authPlugins } from "./src/auth-plugins.js";

export const auth = betterAuth({
  plugins: authPlugins(),
  emailAndPassword: { enabled: true },
});
