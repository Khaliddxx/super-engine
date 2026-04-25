import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { type DbClient } from "@super-engine/db";
import { env } from "../../lib/env.js";

interface Opts extends FastifyPluginOptions {
  db: () => DbClient;
}

export async function authRoutes(app: FastifyInstance, _opts: Opts): Promise<void> {
  app.post<{ Body: { password: string } }>("/login", async (req, reply) => {
    const { password } = req.body ?? { password: "" };
    if (!password || password !== env().OPERATOR_PASSWORD) {
      return reply.status(401).send({ error: "invalid_password" });
    }
    const token = app.jwt.sign({ sub: "operator" }, { expiresIn: "90d" });
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
