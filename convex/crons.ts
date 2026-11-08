import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("sweep abandoned uploads", { hourUTC: 9, minuteUTC: 0 }, internal.books.sweepAbandonedUploads);
export default crons;
