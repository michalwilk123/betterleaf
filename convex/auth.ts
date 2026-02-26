import { betterAuth } from "better-auth/minimal";
import { createClient } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import authConfig from "./auth.config";

export const authComponent = createClient(components.betterAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createAuth = (ctx: any) =>
  betterAuth({
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    trustedOrigins: [
      process.env.SITE_URL!,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    plugins: [
      convex({ authConfig }),
      crossDomain({ siteUrl: process.env.SITE_URL! }),
    ],
  });

export const { getAuthUser } = authComponent.clientApi();
