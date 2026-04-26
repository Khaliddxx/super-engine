import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { type DbClient } from "@super-engine/db";
import { env } from "../../lib/env.js";
import {
  resolveStudioPreviewPassword,
  verifyStudioPreviewPassword,
  isStudioPreviewPasswordConfigured,
} from "../../lib/studio-preview-password.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function authRoutes(app: FastifyInstance, opts: Opts): Promise<void> {
  app.post<{ Body: { password: string } }>("/login", async (req, reply) => {
    const { password } = req.body ?? { password: "" };
    if (!password || password !== env().OPERATOR_PASSWORD) {
      return reply.status(401).send({ error: "invalid_password" });
    }
    const token = app.jwt.sign({ sub: "operator" }, { expiresIn: "90d" });
    return { token };
  });

  /** Password from Controls / env only — unlocks pipeline preview + navbar patch API, nothing else. */
  app.post<{ Body: { password: string } }>("/studio-preview", async (req, reply) => {
    const password = req.body?.password ?? "";
    const expected = await resolveStudioPreviewPassword(opts.db());
    if (!isStudioPreviewPasswordConfigured(expected)) {
      return reply.status(400).send({ error: "studio_preview_password_not_configured" });
    }
    if (!verifyStudioPreviewPassword(password, expected)) {
      return reply.status(401).send({ error: "invalid_password" });
    }
    const token = app.jwt.sign({ sub: "studio_preview" }, { expiresIn: "7d" });
    return { token };
  });

  app.get("/me", async (req, reply) => {
    try {
      await req.jwtVerify();
      return { sub: (req.user as any).sub };
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }
  });
}
