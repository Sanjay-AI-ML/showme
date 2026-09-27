export type Mode = 'guide' | 'collaborate' | 'delegate' | 'manual';
export type FocusTarget = 'customer' | 'items' | 'delivery' | 'terms' | 'preview';
export type Terms = 'due_on_receipt' | 'net_15' | 'net_30';

export interface Customer { id: string; name: string; city: string; email: string }
export interface Product { id: string; name: string; priceCents: number; description: string }
export interface LineItem { id: string; productId: string; quantity: number }
export interface Invoice {
  id: string;
  revision: number;
  customerId: string | null;
  items: LineItem[];
  deliveryCents: number;
  terms: Terms;
  issueDate: string;
  status: 'draft' | 'saved';
  savedAt: string | null;
}
export interface Receipt {
  id: string;
  operation: string;
  beforeRevision: number;
  afterRevision: number;
  summary: string;
  totalCents: number;
  createdAt: string;
}
export interface AppState {
  invoice: Invoice;
  customers: Customer[];
  products: Product[];
  mode: Mode;
  focus: FocusTarget | null;
  lastAction: Receipt | null;
}
export type EditOperation = 'select_customer' | 'upsert_item' | 'remove_item' | 'set_delivery' | 'set_terms' | 'save_draft' | 'undo';
export interface EditRequest {
  operation: EditOperation;
  expectedRevision: number;
  requestId: string;
  source: 'agent' | 'manual';
  customerId?: string;
  productId?: string;
  itemId?: string;
  quantity?: number;
  deliveryCents?: number;
  terms?: Terms;
}
export interface EditResult { state: AppState; receipt: Receipt }

export function calculateTotal(invoice: Invoice, products: Product[]): number {
  return invoice.items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return sum + (product?.priceCents ?? 0) * item.quantity;
  }, invoice.deliveryCents);
}

export function dueDate(invoice: Invoice): string {
  const date = new Date(`${invoice.issueDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (invoice.terms === 'net_15' ? 15 : invoice.terms === 'net_30' ? 30 : 0));
  return date.toISOString().slice(0, 10);
}
