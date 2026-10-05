'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type DynamicToolUIPart, type ToolUIPart } from 'ai';
import { useState } from 'react';

const PROMPTS = [
  'Who owes me money? Oldest first.',
  'Send a reminder to everyone more than 7 days late.',
  'Which invoices has the customer never opened?',
  'Any open PayPal disputes?',
];

type AnyToolPart = ToolUIPart | DynamicToolUIPart;
const toolName = (p: AnyToolPart) => ('toolName' in p ? p.toolName : p.type.replace(/^tool-/, ''));

function ToolCard({ part, onApprove }: { part: AnyToolPart; onApprove: (id: string, ok: boolean) => void }) {
  const name = toolName(part).replaceAll('_', ' ');
  if (part.state === 'approval-requested' && !part.approval.isAutomatic) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
        <div className="font-medium">Approve: {name}?</div>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(part.input, null, 2)}</pre>
        <div className="mt-2 flex gap-2">
          <button className="rounded bg-blue-700 px-3 py-1 text-white" onClick={() => onApprove(part.approval.id, true)}>
            Approve
          </button>
          <button className="rounded border bg-white px-3 py-1" onClick={() => onApprove(part.approval.id, false)}>
            Deny
          </button>
        </div>
      </div>
    );
  }
  const label =
    part.state === 'output-available' ? 'done' :
    part.state === 'output-error' ? `failed: ${part.errorText}` :
    part.state === 'output-denied' ? 'denied' :
    part.state === 'approval-responded' ? (part.approval.approved ? 'approved' : 'denied') : 'running...';
  return (
    <details className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
      <summary>
        PayPal: {name} ({label})
      </summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
        {JSON.stringify({ input: part.input, output: 'output' in part ? part.output : undefined }, null, 2)}
      </pre>
    </details>
  );
}

export default function AgentChat({ onAction }: { onAction: () => void }) {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, addToolApprovalResponse, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/agent' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: onAction,
  });
  const busy = status === 'submitted' || status === 'streaming';
  const ask = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput('');
  };

  return (
    <section className="flex flex-col rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold">3. AR agent</h2>
      <p className="mt-1 text-sm text-gray-600">
        Ask in plain English. It reads PayPal through the PayPal Agent Toolkit and asks before it changes anything.
      </p>
      <div className="mt-3 flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map((p) => (
              <button key={p} className="rounded-full border px-3 py-1 text-sm hover:bg-gray-50" onClick={() => ask(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'self-end max-w-[85%]' : 'max-w-full'}>
            {m.parts.map((part, i) => {
              if (part.type === 'text')
                return (
                  <div key={i} className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-blue-700 text-white' : 'bg-gray-100'}`}>
                    {part.text}
                  </div>
                );
              if (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
                return (
                  <div key={i} className="my-1">
                    <ToolCard part={part as AnyToolPart} onApprove={(id, approved) => addToolApprovalResponse({ id, approved })} />
                  </div>
                );
              return null;
            })}
          </div>
        ))}
        {busy && <div className="text-sm text-gray-500">Working...</div>}
        {error && <div className="text-sm text-red-700">{error.message}</div>}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input className="flex-1 rounded-lg border p-2 text-sm" placeholder="e.g. Record a $200 cash payment on invoice 0003" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="rounded-lg bg-blue-700 px-4 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>
          Ask
        </button>
      </form>
    </section>
  );
}
