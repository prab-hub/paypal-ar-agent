import { openai } from '@ai-sdk/openai';

// One place to change the model. OPENAI_MODEL overrides the default.
export const model = openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini');
