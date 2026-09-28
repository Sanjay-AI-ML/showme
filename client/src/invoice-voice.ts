import { calculateTotal, dueDate, type AppState, type EditOperation, type FocusTarget, type Mode, type Terms } from '../../shared/types';
import type { HostAdapter } from './host';
import type { VoiceIntegration } from './voice';

const fieldHelp: Record<FocusTarget, string> = {
  customer: 'Choose who will receive the invoice. If the customer is missing, use Add a customer below this field.',
  items: 'Add products and quantities. If a product is missing, use Add a product below the item list. The invoice total uses catalog prices.',
  delivery: 'A separate delivery fee is shown as its own line instead of being hidden in an item price.',
  terms: 'Payment terms decide the due date: on receipt, 15 days, or 30 days after the issue date.',
  preview: 'Review the customer, quantities, delivery fee, total, and due date before saving the draft.',
};

const tools = [
  { type: 'function', name: 'read_context', description: 'Read the current invoice, customer and product catalog, selected field, and permitted mode. Call before resolving names or after a manual change.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'edit_invoice', description: 'Make one reversible invoice edit when the user asks you to do it. Never call in Guide me or Let me take over mode. Use exact catalog IDs from read_context. Delivery amount is in whole rupees. For a correction, edit the existing product rather than adding a duplicate.', parameters: { type: 'object', properties: {
    operation: { type: 'string', enum: ['select_customer', 'upsert_item', 'remove_item', 'set_delivery', 'set_terms'] },
    customer_id: { type: 'string', description: 'Exact customer ID from read_context' },
    product_id: { type: 'string', description: 'Exact product ID from read_context' },
    quantity: { type: 'integer', minimum: 1, maximum: 999 },
    delivery_rupees: { type: 'integer', minimum: 0, description: 'Whole rupees, e.g. 500 for ₹500' },
    terms: { type: 'string', enum: ['due_on_receipt', 'net_15', 'net_30'] },
  }, required: ['operation'] } },
  { type: 'function', name: 'highlight_field', description: 'Highlight a relevant field when explaining how the user can do something. Do not mutate invoice data.', parameters: { type: 'object', properties: { field: { type: 'string', enum: ['customer', 'items', 'delivery', 'terms', 'preview'] } }, required: ['field'] } },
  { type: 'function', name: 'explain_field', description: 'Read the app-authored explanation for a field, especially when the user asks what this means. Use the focused field from read_context when the user says this.', parameters: { type: 'object', properties: { field: { type: 'string', enum: ['customer', 'items', 'delivery', 'terms', 'preview'] } }, required: ['field'] } },
  { type: 'function', name: 'change_mode', description: 'Switch assistance mode when the user requests guidance, doing together, doing it quickly, or manual takeover.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['guide', 'collaborate', 'delegate', 'manual'] } }, required: ['mode'] } },
  { type: 'function', name: 'undo_agent_edit', description: 'Undo the most recent compatible agent edit only when the user asks to undo.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'save_draft', description: 'Save the invoice as a draft when the user explicitly asks to save. Never claim it saved before the tool returns success.', parameters: { type: 'object', properties: {} } },
];

function summarize(state: AppState) {
  const { invoice, products, customers } = state;
  return {
    mode: state.mode, focusedField: state.focus, revision: invoice.revision,
    customer: invoice.customerId ? customers.find((item) => item.id === invoice.customerId)?.name : null,
    items: invoice.items.map((item) => ({ product: products.find((entry) => entry.id === item.productId)?.name, quantity: item.quantity })),
    deliveryRupees: invoice.deliveryCents / 100, terms: invoice.terms, status: invoice.status,
    invoiceId: invoice.id, totalRupees: calculateTotal(invoice, products) / 100,
    issueDate: invoice.issueDate, dueDate: dueDate(invoice),
    customers: customers.map(({ id, name }) => ({ id, name })),
    products: products.map(({ id, name, priceCents }) => ({ id, name, rupees: priceCents / 100 })),
  };
}

export function createInvoiceVoiceIntegration(host: HostAdapter): VoiceIntegration<AppState> {
  return {
    getContext: () => host.getContext(), summarize, tools,
    errorNoun: 'invoice',
    greeting: 'Hi, I’m ShowMe. Tell me what you want to do, or ask me to guide you.',
    systemPrompt: (initial) => `You are ShowMe, a concise voice companion embedded in an invoice app. Help the user finish an accurate invoice and learn the app. Use read_context before guessing any catalog name or current field. If a customer or product is missing from the catalog, guide the user to Add a customer or Add a product in the app, then read context again. You cannot create catalog records yourself. Only speak customer names, prices, totals, dates, and save outcomes obtained from tools. Never invent an action result. In guide mode, explain and highlight; do not edit. In collaborate mode, do reversible requested edits and briefly explain useful steps. In delegate mode, execute supported requests efficiently. In manual mode, answer questions without editing. Ask one short question for missing or ambiguous values. Follow user corrections immediately. If a tool fails, say what failed and what remains unchanged. Keep spoken turns to one or two short sentences. Current state: ${JSON.stringify(summarize(initial))}`,
    async execute(call, events) {
      const args = call.arguments;
      if (call.name === 'read_context') return summarize(await host.getContext());
      if (call.name === 'highlight_field' || call.name === 'explain_field') {
        const target = args.field as FocusTarget;
        if (!(target in fieldHelp)) throw new Error('Unknown field.');
        await host.focus(target);
        events.highlight(target);
        return { field: target, explanation: fieldHelp[target] };
      }
      if (call.name === 'change_mode') {
        const state = await host.setMode(args.mode as Mode);
        return { mode: state.mode };
      }
      if (!['edit_invoice', 'save_draft', 'undo_agent_edit'].includes(call.name)) throw new Error('Unsupported tool.');
      const state = await host.getContext();
      const operation: EditOperation = call.name === 'save_draft' ? 'save_draft' : call.name === 'undo_agent_edit' ? 'undo' : args.operation as EditOperation;
      if (!['select_customer', 'upsert_item', 'remove_item', 'set_delivery', 'set_terms', 'save_draft', 'undo'].includes(operation)) throw new Error('Unsupported action.');
      const outcome = await host.execute({
        operation, expectedRevision: state.invoice.revision, requestId: call.call_id, source: 'agent',
        customerId: args.customer_id as string | undefined,
        productId: args.product_id as string | undefined,
        quantity: args.quantity as number | undefined,
        deliveryCents: typeof args.delivery_rupees === 'number' ? Math.round(args.delivery_rupees * 100) : undefined,
        terms: args.terms as Terms | undefined,
      });
      return { success: true, receipt: outcome.receipt, invoice: summarize(outcome.state) };
    },
  };
}
