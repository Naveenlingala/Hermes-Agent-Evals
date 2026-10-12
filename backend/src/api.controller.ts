import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ConfigsService } from './configs/configs.service';
import { ExperimentsService } from './experiments/experiments.service';
import { GradingService } from './grading/grading.service';
import { METRIC_CATALOG } from './grading/metric-catalog';
import { Catalog, readCatalog } from './hermes/catalog';
import { TasksService } from './tasks/tasks.service';
import { TraceService } from './trace/trace.service';

@Controller('api')
export class ApiController {
  constructor(private tasks: TasksService, private configs: ConfigsService, private exps: ExperimentsService, private grading: GradingService, private trace: TraceService) {}

  @Get('health') health() {
    return { status: 'ok', judge: this.grading.judgeInfo, runners: { mock: 'always available', hermes: `shells out to "${process.env.HERMES_BIN ?? 'hermes'}" when a config uses runner=hermes` } };
  }
  /** Recent API requests and backend events (ring buffer). `since` = last seq seen. */
  @Get('debug/requests') debugRequests(@Query('since') since?: string) { return this.trace.list(Number(since) || 0); }
  /** Destructive: deletes all tasks, configs, experiments and runs. Refused (409) while an experiment is running. */
  @Post('reset') reset() { return this.exps.reset(); }
  private catalog?: { at: number; value: Catalog };
  /** What the local Hermes install offers (toolsets, skills, default model) plus models used by saved configs. Cached 60s; `?refresh=1` bypasses. */
  @Get('hermes/catalog') async hermesCatalog(@Query('refresh') refresh?: string) {
    if (!this.catalog || refresh || Date.now() - this.catalog.at > 60_000) this.catalog = { at: Date.now(), value: await readCatalog() };
    const used = [...new Set(this.configs.list().map((c) => c.model).filter(Boolean))];
    return { ...this.catalog.value, usedModels: used };
  }
  @Get('overview') overview() { return this.exps.overview(); }

  @Get('tasks') listTasks() { return this.tasks.list(); }
  @Get('tasks/:id') getTask(@Param('id') id: string) { return this.tasks.get(id); }
  @Post('tasks') createTask(@Body() b: unknown) { return this.tasks.create(b); }

  @Get('configs') listConfigs() { return this.configs.list(); }
  @Get('configs/:id') getConfig(@Param('id') id: string) { return this.configs.get(id); }
  @Post('configs') createConfig(@Body() b: unknown) { return this.configs.create(b); }

  @Get('experiments') listExperiments() { return this.exps.list().map(({ events: _events, ...e }) => e); } // events only on the detail endpoint
  @Post('experiments') createExperiment(@Body() b: unknown) { return this.exps.create(b); }
  @Get('experiments/:id') getExperiment(@Param('id') id: string) {
    const experiment = this.exps.get(id);
    const runs = this.exps.runs(id);
    // list view omits heavy trace/raw payloads; fetch /api/runs/:id for those
    const slim = runs.map(({ result, grades: _g, taskSnapshot: _t, configSnapshot: _c, ...r }) => ({
      ...r, latencyMs: result.latencyMs, tokens: result.inputTokens + result.outputTokens, error: result.error,
    }));
    return { experiment, summaries: this.exps.summaries(runs), runs: slim };
  }
  @Get('experiments/:id/comparison') comparison(@Param('id') id: string, @Query('a') a?: string, @Query('b') b?: string) { return this.exps.comparison(id, a, b); }
  @Get('runs/:id') getRun(@Param('id') id: string) { return this.exps.run(id); }

  @Get('evaluators') evaluators() {
    return {
      deterministic: [
        { type: 'contains', dimension: 'success', description: 'Final output contains a string (case-insensitive by default).' },
        { type: 'not_contains', dimension: 'success', description: 'Final output must not contain a string.' },
        { type: 'regex', dimension: 'success', description: 'Final output matches a regular expression.' },
        { type: 'tool_called', dimension: 'tool', description: 'A named tool (or * for any tool) appears in the trace, optionally with args containing a string. Tool graders only affect pass/fail when marked required.' },
        { type: 'tool_not_called', dimension: 'tool', description: 'A named tool must not appear in the trace.' },
        { type: 'max_tool_calls', dimension: 'tool', description: 'Total tool calls stay within a budget.' },
        { type: 'min_tool_calls', dimension: 'tool', description: 'At least N tool calls happened (name-agnostic proof the agent used tools).' },
      ],
      deterministicVersion: 'det-1.0.0',
      metrics: METRIC_CATALOG,
      judge: { ...this.grading.judgeInfo, version: 'judge-1.0.0', schema: '{"score": integer 1-5, "evidence": string}', note: 'Reported as answer quality only; never part of pass/fail.' },
    };
  }
}
