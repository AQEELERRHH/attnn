import { notFound } from "next/navigation";
import { DesignPreview } from "./preview";

export const metadata = { title: "Design system · Attnn.", robots: { index: false } };

/**
 * Living reference for the market design system. Visible locally and on Vercel
 * preview deployments, 404 on production.
 */
export default function DesignPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <DesignPreview />;
}
