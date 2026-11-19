import { clerkMiddleware } from "@clerk/nextjs/server";

// Next 16 renamed middleware.ts to proxy.ts. Clerk attaches session state here;
// it is NOT an authorization boundary. All authorization happens in Convex.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
