import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: "operator" | "studio_preview" };
    user: { sub: "operator" | "studio_preview" };
  }
}

const PROSPECT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STUDIO_PREVIEW_DETAIL_GET = new RegExp(`^/api/pipeline/${PROSPECT_ID}$`, "i");
const STUDIO_PREVIEW_PATCH_POST = new RegExp(`^/api/pipeline/${PROSPECT_ID}/redesign-html-patch$`, "i");

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    reply.status(401).send({ error: "unauthorized" });
    return;
  }
  const sub = req.user?.sub;
  if (sub === "studio_preview") {
    const url = String(req.url ?? "").split("?")[0] ?? "";
    const method = String(req.method ?? "GET").toUpperCase();
    const allowed =
      (method === "GET" && STUDIO_PREVIEW_DETAIL_GET.test(url)) ||
      (method === "POST" && STUDIO_PREVIEW_PATCH_POST.test(url));
    if (!allowed) {
      reply.status(403).send({ error: "forbidden" });
      return;
    }
  }
}

export function protectedRoutes(app: FastifyInstance): FastifyInstance {
  app.addHook("onRequest", requireAuth);
  return app;
}
