import { betterAuth } from "better-auth";
import { authPlugins, authUserFields } from "./src/auth-plugins.js";
import Stripe from "stripe";

export const auth = betterAuth({
  plugins: authPlugins([], false, {
    stripeClient: new Stripe("schema-generation-only"),
    stripeWebhookSecret: "schema-generation-only",
    createCustomerOnSignUp: false,
    organization: { enabled: true },
    subscription: { enabled: true, plans: [] },
  }),
  user: { additionalFields: authUserFields },
  emailAndPassword: { enabled: true },
});
