import { Inngest } from "inngest";

// Create an Inngest client for the Attnn application
export const inngest = new Inngest({
  id: "attnn",
  name: "Attnn - Agentic Attention Marketplace",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
