import "reflect-metadata";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { resolve } from "node:path";
import { AppModule } from "./app.module.js";
import { configureOpenApi } from "./openapi.js";
import { randomUUID } from "node:crypto";
import { runWithCorrelation, StructuredLogger } from "./observability.js";
import { registerBrowserSessions } from "./browser-session.js";

const logger = new StructuredLogger();
const adapter = new FastifyAdapter();
const requestStartTimes = new WeakMap<object, number>();
const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
  logger: false,
});
await registerBrowserSessions(adapter.getInstance());
adapter.getInstance().addHook("onRequest", (request, reply, done) => {
  const supplied = request.headers["x-correlation-id"];
  const correlationId =
    typeof supplied === "string" && supplied.length > 0 && supplied.length <= 160
      ? supplied
      : randomUUID();
  reply.header("x-correlation-id", correlationId);
  const startedAt = performance.now();
  runWithCorrelation(correlationId, () => {
    logger.info("http.request.started", {
      requestId: request.id,
      method: request.method,
      path: request.url,
    });
    requestStartTimes.set(request, startedAt);
    done();
  });
});
adapter.getInstance().addHook("onResponse", (request, reply, done) => {
  const correlationId = String(reply.getHeader("x-correlation-id") ?? request.id);
  runWithCorrelation(correlationId, () => {
    const startedAt = requestStartTimes.get(request);
    logger.info("http.request.completed", {
      requestId: request.id,
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
      ...(typeof startedAt === "number"
        ? { durationMs: Number((performance.now() - startedAt).toFixed(3)) }
        : {}),
    });
    done();
  });
});
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "validator.swagger.io"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
});
configureOpenApi(app);
await app.register(staticFiles, {
  root: resolve(process.cwd(), "portal", "dist"),
  prefix: "/portal/",
  wildcard: false,
});
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3000) });
