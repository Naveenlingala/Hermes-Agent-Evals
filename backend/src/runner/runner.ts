import type { AgentConfig, AgentRunResult, Task } from '../domain/types';

export interface RunRequest { task: Pick<Task, 'id' | 'prompt' | 'mock' | 'setupPrompts'> & { category?: string }; config: AgentConfig; trial: number }

/** The only seam between the platform and an agent. Swap implementations; tests use fakes. */
export interface AgentRunner { readonly kind: 'mock' | 'hermes'; run(req: RunRequest): Promise<AgentRunResult> }

export const RUNNERS = Symbol('RUNNERS');
export type RunnerMap = Record<'mock' | 'hermes', AgentRunner>;

export const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
