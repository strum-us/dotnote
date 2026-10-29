import { redirect } from "next/navigation";

export default function LegacyAiImageRedirect() {
  redirect("/settings/ai/image");
}
