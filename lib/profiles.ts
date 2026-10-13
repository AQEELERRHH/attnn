import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/** Handles are unique ignoring case (like the registry on Arc), so lookups ignore it too. */
export const handleIs = (handle: string) => sql`lower(${profiles.handle}) = ${handle.trim().replace(/^@/, "").toLowerCase()}`;

export async function getFullProfileByHandle(handle: string) {
  return db.query.profiles.findFirst({
    where: handleIs(handle),
    with: { user: true },
  });
}
