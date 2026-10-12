import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ConfigsService } from './configs/configs.service';
import { DbService } from './db/db.service';
import { ExperimentsService } from './experiments/experiments.service';
import { GradingService } from './grading/grading.service';
import { Judge, createJudge } from './grading/judge';
import { HermesRunner } from './runner/hermes.runner';
import { MockRunner } from './runner/mock.runner';
import { RUNNERS, RunnerMap } from './runner/runner';
import { SeedService } from './seed/seed.service';
import { TraceMiddleware } from './trace/trace.middleware';
import { TraceService } from './trace/trace.service';
import { TasksService } from './tasks/tasks.service';

@Module({
  controllers: [ApiController],
  providers: [
    DbService, TraceService, TasksService, ConfigsService, ExperimentsService, SeedService,
    { provide: RUNNERS, useFactory: (): RunnerMap => ({ mock: new MockRunner(), hermes: new HermesRunner() }) },
    { provide: GradingService, useFactory: () => new GradingService(createJudge()) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TraceMiddleware).forRoutes('*'); }
}
export type { Judge };
