import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { createOpenApiDocument } from "./openapi.js";

process.env.ASSESSMENT_WORKER_ENABLED = "false";

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
  { logger: false },
);

try {
  await app.init();
  const document = createOpenApiDocument(app);
  const outputUrl = new URL("../openapi.json", import.meta.url);
  await writeFile(outputUrl, `${JSON.stringify(document, null, 2)}\n`, "utf8");
} finally {
  await app.close();
}
