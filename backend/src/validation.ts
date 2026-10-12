import { BadRequestException } from '@nestjs/common';
import type { GraderSpec } from './domain/types';

export class Check {
  private errors: string[] = [];
  constructor(private body: any) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({ message: 'Request body must be a JSON object', errors: ['body'] });
    }
  }
  str(key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string | undefined {
    const v = this.body[key];
    if (v === undefined || v === '') { if (!opts.optional) this.errors.push(`${key} is required`); return undefined; }
    if (typeof v !== 'string') { this.errors.push(`${key} must be a string`); return undefined; }
    const t = v.trim();
    if (t.length < (opts.min ?? 1)) this.errors.push(`${key} is too short`);
    if (t.length > (opts.max ?? 20000)) this.errors.push(`${key} is too long`);
    return t;
  }
  num(key: string, opts: { min: number; max: number; int?: boolean; optional?: boolean }): number | undefined {
    const v = this.body[key];
    if (v === undefined) { if (!opts.optional) this.errors.push(`${key} is required`); return undefined; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < opts.min || v > opts.max || (opts.int && !Number.isInteger(v))) {
      this.errors.push(`${key} must be ${opts.int ? 'an integer' : 'a number'} between ${opts.min} and ${opts.max}`);
      return undefined;
    }
    return v;
  }
  strArray(key: string, opts: { minItems: number; maxItems: number }): string[] {
    const v = this.body[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { this.errors.push(`${key} must be an array of strings`); return []; }
    if (v.length < opts.minItems || v.length > opts.maxItems) this.errors.push(`${key} must have ${opts.minItems}-${opts.maxItems} items`);
    return [...new Set(v as string[])];
  }
  raw(key: string): unknown { return this.body[key]; }
  fail(msg: string) { this.errors.push(msg); }
  done() {
    if (this.errors.length) throw new BadRequestException({ message: 'Validation failed', errors: this.errors });
  }
}

export function parseGraders(input: unknown, check: Check): GraderSpec[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) { check.fail('graders must be a non-empty array (max 20)'); return []; }
  const out: GraderSpec[] = [];
  const ids = new Set<string>();
  input.forEach((g: any, i) => {
    const p = `graders[${i}]`;
    if (!g || typeof g !== 'object') return check.fail(`${p} must be an object`);
    const id = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : `g${i + 1}`;
    if (ids.has(id)) return check.fail(`${p}.id is duplicated`);
    ids.add(id);
    const s = (k: string) => (typeof g[k] === 'string' && g[k].length > 0 && g[k].length <= 500 ? (g[k] as string) : undefined);
    switch (g.type) {
      case 'contains':
      case 'not_contains': {
        const value = s('value'); if (!value) return check.fail(`${p}.value is required`);
        out.push({ id, type: g.type, dimension: 'success', value, caseSensitive: g.caseSensitive === true }); break;
      }
      case 'regex': {
        const pattern = s('pattern'); if (!pattern) return check.fail(`${p}.pattern is required`);
        const flags = typeof g.flags === 'string' && /^[gimsuy]{0,6}$/.test(g.flags) ? g.flags : '';
        try { new RegExp(pattern, flags); } catch { return check.fail(`${p}.pattern is not a valid regular expression`); }
        out.push({ id, type: 'regex', dimension: 'success', pattern, flags }); break;
      }
      case 'tool_called': {
        const tool = s('tool'); if (!tool) return check.fail(`${p}.tool is required`);
        out.push({ id, type: 'tool_called', dimension: 'tool', tool, argsContain: s('argsContain'), required: g.required === true }); break;
      }
      case 'tool_not_called': {
        const tool = s('tool'); if (!tool) return check.fail(`${p}.tool is required`);
        out.push({ id, type: 'tool_not_called', dimension: 'tool', tool, required: g.required === true }); break;
      }
      case 'max_tool_calls': {
        if (!Number.isInteger(g.max) || g.max < 0 || g.max > 100) return check.fail(`${p}.max must be an integer 0-100`);
        out.push({ id, type: 'max_tool_calls', dimension: 'tool', max: g.max, required: g.required === true }); break;
      }
      case 'llm_criterion': {
        const criterion = typeof g.criterion === 'string' ? g.criterion.trim() : '';
        if (!criterion || criterion.length > 500) return check.fail(`${p}.criterion must be 1-500 characters`);
        const passScore = g.passScore === undefined ? 4 : g.passScore;
        if (!Number.isInteger(passScore) || passScore < 1 || passScore > 5) return check.fail(`${p}.passScore must be an integer 1-5`);
        out.push({ id, type: 'llm_criterion', dimension: 'success', criterion, passScore }); break;
      }
      case 'min_tool_calls': {
        if (!Number.isInteger(g.min) || g.min < 1 || g.min > 100) return check.fail(`${p}.min must be an integer 1-100`);
        out.push({ id, type: 'min_tool_calls', dimension: 'tool', min: g.min, required: g.required === true }); break;
      }
      default: check.fail(`${p}.type is unknown`);
    }
  });
  return out;
}

export function parseExpected(input: unknown, check: Check): import('./domain/types').ExpectedSpec | undefined {
  if (input === undefined || input === null) return undefined;
  const o = input as any;
  if (typeof o !== 'object' || Array.isArray(o)) { check.fail('expected must be an object'); return undefined; }
  const out: import('./domain/types').ExpectedSpec = {};
  if (o.tools !== undefined) {
    if (!Array.isArray(o.tools) || o.tools.length > 10) { check.fail('expected.tools must be an array (max 10)'); return undefined; }
    out.tools = [];
    o.tools.forEach((t: any, i: number) => {
      if (!t || typeof t.tool !== 'string' || !t.tool.trim() || t.tool.length > 100) return check.fail(`expected.tools[${i}].tool is required`);
      let args: Record<string, string> | undefined;
      if (t.args !== undefined) {
        if (typeof t.args !== 'object' || t.args === null || Array.isArray(t.args) || Object.keys(t.args).length > 10 || Object.values(t.args).some((v) => typeof v !== 'string' || !v || (v as string).length > 300)) return check.fail(`expected.tools[${i}].args must map keys to non-empty strings`);
        args = t.args;
      }
      out.tools!.push({ tool: t.tool.trim(), args });
    });
  }
  if (o.optimalSteps !== undefined) {
    if (!Number.isInteger(o.optimalSteps) || o.optimalSteps < 1 || o.optimalSteps > 100) check.fail('expected.optimalSteps must be an integer 1-100'); else out.optimalSteps = o.optimalSteps;
  }
  return out.tools?.length || out.optimalSteps ? out : undefined;
}

export function parseJudgeMetrics(input: unknown, check: Check): import('./domain/types').JudgeMetricsOpt | undefined {
  if (input === undefined || input === null) return undefined;
  const o = input as any;
  if (typeof o !== 'object' || Array.isArray(o)) { check.fail('judgeMetrics must be an object'); return undefined; }
  const out: import('./domain/types').JudgeMetricsOpt = {};
  for (const k of ['stepEfficiency', 'planQuality', 'planAdherence', 'toolCalls'] as const) if (o[k] === true) out[k] = true;
  return Object.keys(out).length ? out : undefined;
}
