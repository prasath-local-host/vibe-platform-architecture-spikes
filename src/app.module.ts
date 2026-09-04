import { Module } from "@nestjs/common";
import { AppController } from "./controller.js";
import { AssessmentController } from "./assessment-controller.js";
import { ApplicationService } from "./application-service.js";
import { AssessmentService, AssessmentWorker } from "./assessment-service.js";
import { AssessmentWorkerHost } from "./assessment-worker-host.js";
import { BuildController } from "./build-controller.js";
import { BuildJobService, BuildJobWorker } from "./build-job-service.js";
import { BuildWorkerHost } from "./build-worker-host.js";
import { IdentityService } from "./identity.js";
import {
  createApplicationRuntime,
  type ApplicationRuntime,
} from "./persistence.js";

const APPLICATION_RUNTIME = Symbol("APPLICATION_RUNTIME");

@Module({
  controllers: [AppController, AssessmentController, BuildController],
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
    AssessmentWorkerHost,
    BuildWorkerHost,
  ],
})
export class AppModule {}
