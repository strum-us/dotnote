import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";
import { apiApp } from "../../../../worker/index";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const { env, ctx } = await getCloudflareContext({ async: true });
  return apiApp.fetch(request, env, ctx);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
