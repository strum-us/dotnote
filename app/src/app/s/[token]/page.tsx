"use client";

import { PublicSharePage } from "@/components/PublicSharePage";
import { useParams } from "@/lib/next-router-compat";

export default function PublicShareRoutePage() {
  const { token } = useParams<{ token: string }>();
  if (!token) return null;
  return <PublicSharePage token={token} />;
}
