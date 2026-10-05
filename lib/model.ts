import { openai } from '@ai-sdk/openai';

// One place to change the model. OPENAI_MODEL overrides the default.
export const model = openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini');

// Accounting judgment (revenue recognition) is worth a stronger model; it runs once per invoice line and is cached.
export const judgmentModel = openai(process.env.OPENAI_JUDGMENT_MODEL || 'gpt-5.5');
