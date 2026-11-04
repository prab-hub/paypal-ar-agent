import { anthropic } from '@ai-sdk/anthropic';

// One place to change the model. ANTHROPIC_MODEL overrides the default.
// Haiku 5.5 runs the agent loop: $0.10/$0.50 per 1M tokens and solid at tool calling.
export const model = anthropic(process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5');

// Accounting judgment (revenue recognition, disputes) is worth a stronger model; it runs once per invoice line and is cached.
export const judgmentModel = anthropic(process.env.ANTHROPIC_JUDGMENT_MODEL || 'claude-sonnet-5-5');
