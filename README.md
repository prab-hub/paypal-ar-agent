# Settle: AI accounts receivable on PayPal

**Live demo:** https://settle-paypal.vercel.app (PayPal sandbox, no real money)

Small businesses wait weeks to get paid because invoicing and chasing are manual. Settle runs the
quote-to-cash loop on PayPal with AI doing the busywork and a human approving anything that touches money.

1. **Quote to invoice.** Paste a scope, quote, PO or email thread. AI extracts the customer, line items, terms
   and PO reference, flags anything ambiguous, and you create and send a PayPal invoice in one click.
2. **Receivables.** A live ledger of every PayPal invoice: balance, due date, days late, collection stage, and
   whether the customer has opened it.
3. **Collections.** Click a late invoice and AI drafts a reminder whose tone escalates with lateness
   (friendly, neutral, firm, final) and adapts to partial payments and unopened invoices. Edit, then send it
   through PayPal's reminder API.
4. **Revenue recognition (ASC 606 / IFRS 15).** AI reads every PayPal invoice line and decides whether it is
   earned at a point in time (a build, a design, hours already worked) or over a service period (hosting, a
   subscription, a retainer), with the period and a reason. A monthly waterfall shows billed, collected, recognized,
   deferred and unbilled revenue. Full months get equal amounts and partial months are split by their days. Edit any
   line, download the schedule as CSV.
5. **AR agent.** Ask "who owes me money?" or "remind everyone more than 7 days late". The agent uses the
   PayPal Agent Toolkit to read invoices, transactions and disputes. Any write (send, remind, record payment,
   cancel) pauses for your approval, and approvals are signed server-side. It can also answer revenue questions
   ("how much did we earn in October, what's deferred?") from the same schedule.

## PayPal and AI used

| Piece | Where |
|---|---|
| PayPal Invoicing API v2 (create, send, remind, list) | `lib/paypal.ts` |
| PayPal Agent Toolkit (`@paypal/agent-toolkit`): invoices, transactions, insights, disputes, orders | `lib/agent-tools.ts`, `app/api/agent` |
| AI SDK 7 structured output for extraction and reminders | `lib/extract.ts`, `lib/reminder.ts` |
| AI SDK 7 tool loop with human approval | `app/api/agent/route.ts`, `components/AgentChat.tsx` |
| AG Grid receivables ledger and editable obligations grid | `components/Ledger.tsx`, `components/RevRec.tsx` |
| Revenue schedule math (pure, tested by hand against known cases) | `lib/revrec.ts` |
| AI line classification for revenue recognition | `lib/revrec-classify.ts` |

The toolkit's AI SDK adapter targets AI SDK v4; `lib/agent-tools.ts` re-wraps its tools for v7.

## Run it

```
cp .env.example .env.local   # add PayPal sandbox client id/secret and an OpenAI key
npm install
npm run dev
```

Sandbox buyers: use **US** Personal accounts as customers (PayPal blocks sending invoices to recipients in India). Create them under Testing Tools > Sandbox Accounts. Log in at sandbox.paypal.com as the buyer to pay an invoice.

## License

MIT
