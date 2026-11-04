import { handle } from "@/lib/http";
import { addEvidence } from "@/lib/uploads";

/** Seller uploads a carrier screenshot/PDF or a photo of the item. multipart/form-data: file, kind, title? */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    return addEvidence(id, file, String(form.get("kind") ?? "carrier_document"), String(form.get("title") ?? ""));
  });
}
