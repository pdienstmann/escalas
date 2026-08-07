/** Allow local dev, OpenAI Sites auth, Cloudflare Access, and Workers deploy. */
export function permitted(request: Request) {
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".workers.dev")) return true;
  if (request.headers.get("oai-authenticated-user-id")) return true;
  if (request.headers.get("cf-access-authenticated-user-email")) return true;
  return false;
}
