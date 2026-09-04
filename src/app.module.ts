import { Module } from "@nestjs/common";
import { AppController } from "./controller.js";
import { AssessmentController } from "./assessment-controller.js";
import { ApplicationService } from "./application-service.js";
import { AssessmentService, AssessmentWorker } from "./assessment-service.js";
import { AssessmentWorkerHost } from "./assessment-worker-host.js";
import { BuildController } from "./build-controller.js";
import { BuildJobService, BuildJobWorker } from "./build-job-service.js";
import { BuildWorkerHost } from "./build-worker-host.js";
import { ReleaseController } from "./release-controller.js";
import { ReleaseService, ReleaseWorker } from "./release-service.js";
import { ReleaseWorkerHost } from "./release-worker-host.js";
import { IdentityService } from "./identity.js";
import {
  createApplicationRuntime,
  type ApplicationRuntime,
} from "./persistence.js";

const APPLICATION_RUNTIME = Symbol("APPLICATION_RUNTIME");

@Module({
  controllers: [AppController, AssessmentController, BuildController, ReleaseController],
  providers: [
    {
      provide: APPLICATION_RUNTIME,
      useFactory: () => createApplicationRuntime(process.env.DATABASE_URL),
    },
    {
      provide: ApplicationService,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.applications,
    },
    {
      provide: IdentityService,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.identity,
    },
    {
      provide: AssessmentService,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.assessments,
    },
    {
      provide: AssessmentWorker,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.assessmentWorker,
    },
    {
      provide: BuildJobService,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.builds,
    },
    {
      provide: BuildJobWorker,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.buildWorker,
    },
    {
      provide: ReleaseService,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.releases,
    },
    {
      provide: ReleaseWorker,
      inject: [APPLICATION_RUNTIME],
      useFactory: (runtime: ApplicationRuntime) => runtime.releaseWorker,
    },
    AssessmentWorkerHost,
    BuildWorkerHost,
    ReleaseWorkerHost,
  ],
})
export class AppModule {}
