import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireChatGPTUser } from "../chatgpt-auth";
import { AdminDashboard } from "./admin-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner dashboard — RAG FOR ALL",
  robots: { index: false, follow: false },
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default async function AdminPage() {
  const requestHeaders = await headers();
  const hostname = (requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "").split(":")[0];
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    await requireChatGPTUser("/admin");
  }
  return <AdminDashboard />;
}
