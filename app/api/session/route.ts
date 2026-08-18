import { env } from "cloudflare:workers";
import { permitted } from "../../../lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!permitted(request)) return Response.json({ error: "Não autorizado" }, { status: 401 });
  const host = new URL(request.url).hostname;
  const email = request.headers.get("cf-access-authenticated-user-email") || "";
  if (email) {
    try {
      const user = await env.DB.prepare("SELECT id,email,name,role,active FROM users WHERE lower(email)=lower(?) LIMIT 1").bind(email).first<Record<string, unknown>>();
      if (user && Number(user.active) !== 0) return Response.json({ authenticated: true, source: "cloudflare-access", ...user });
      return Response.json({ authenticated: true, source: "cloudflare-access", email, name: email.split("@")[0], role: "viewer", active: 1 });
    } catch {
      return Response.json({ authenticated: true, source: "cloudflare-access", email, name: email.split("@")[0], role: "viewer", active: 1 });
    }
  }
  return Response.json({ authenticated: true, source: host.endsWith(".workers.dev") ? "compatibility" : "local", name: "Acesso atual", role: "admin", active: 1 });
}
