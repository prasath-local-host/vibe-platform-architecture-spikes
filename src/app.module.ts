import { Module } from "@nestjs/common";
import { AppController } from "./controller.js";

@Module({ controllers: [AppController] })
export class AppModule {}

