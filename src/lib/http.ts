/** Small helpers for route handlers. */
export function ok(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(e: unknown, status = 400) {
  const message = e instanceof Error ? e.message : String(e);
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handle(fn: () => Promise<unknown> | unknown) {
  try {
    return ok(await fn());
  } catch (e) {
    console.error(e);
    return fail(e);
  }
}
