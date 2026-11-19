import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Re-queue outbox events whose delivery chain died (see notify.sweepStale).
crons.interval("sweep stalled notifications", { minutes: 15 }, internal.notify.sweepStale, {});

export default crons;
