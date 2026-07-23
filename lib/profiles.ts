import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function getFullProfileByHandle(handle: string) {
  return db.query.profiles.findFirst({
    where: eq(profiles.handle, handle),
    with: { user: true },
  });
}
