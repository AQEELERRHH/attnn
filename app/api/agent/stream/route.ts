import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { agentLogs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let lastLogCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial data
      const logs = await db.query.agentLogs.findMany({
        where: eq(agentLogs.userId, session.user!.id),
        orderBy: desc(agentLogs.createdAt),
        limit: 50,
      });
      controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "init", logs }) + "\n\n"));
      lastLogCount = logs.length;

      // Poll for new logs every 3 seconds
      const interval = setInterval(async () => {
        try {
          const newLogs = await db.query.agentLogs.findMany({
            where: eq(agentLogs.userId, session.user!.id),
            orderBy: desc(agentLogs.createdAt),
            limit: 50,
          });
          if (newLogs.length > lastLogCount) {
            controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "update", logs: newLogs.slice(0, newLogs.length - lastLogCount) }) + "\n\n"));
            lastLogCount = newLogs.length;
          }
          // Send keepalive
          controller.enqueue(encoder.encode("data: {\"type\":\"ping\"}\n\n"));
        } catch (err) {
          // Connection closed, ignore
        }
      }, 3000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
