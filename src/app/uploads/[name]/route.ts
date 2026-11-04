import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/uploads";

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^[a-z0-9-]+\.(png|jpe?g|webp|pdf)$/i.test(name)) return new Response("Not found", { status: 404 });
  const p = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  const ext = name.split(".").pop()!.toLowerCase();
  const type = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return new Response(fs.readFileSync(p), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
}
