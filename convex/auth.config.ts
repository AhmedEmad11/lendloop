import type { AuthConfig } from "convex/server";

// Clerk issues a JWT from the "convex" JWT template; Convex verifies it against
// the issuer's JWKS. CLERK_JWT_ISSUER_DOMAIN is set on the Convex deployment
// (`npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev`).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
