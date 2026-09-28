import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  calculateTotal,
  type AppState, type Customer, type EditOperation, type EditRequest,
  type EditResult, type FocusTarget, type Invoice, type Mode, type Product, type Receipt,
} from '../shared/types.js';

export const CUSTOMERS: Customer[] = [
  { id: 'sunrise', name: 'Sunrise Studio', city: 'Pune', email: 'accounts@sunrise.example' },
  { id: 'atlas', name: 'Atlas Workspace', city: 'Mumbai', email: 'billing@atlas.example' },
  { id: 'cedar', name: 'Cedar & Co.', city: 'Bengaluru', email: 'team@cedar.example' },
];
export const PRODUCTS: Product[] = [
  { id: 'chair', name: 'Oak chair', priceCents: 250000, description: 'Solid oak, natural finish' },
  { id: 'table', name: 'Studio table', priceCents: 780000, description: 'Four seat table' },
  { id: 'lamp', name: 'Desk lamp', priceCents: 180000, description: 'Warm white LED' },
];

const requestSchema = z.object({
  operation: z.enum(['select_customer', 'upsert_item', 'remove_item', 'set_delivery', 'set_terms', 'save_draft', 'undo']),
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().min(6).max(128),
  source: z.enum(['agent', 'manual']),
  customerId: z.string().optional(), productId: z.string().optional(), itemId: z.string().optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  deliveryCents: z.number().int().min(0).max(100000000).optional(),
  terms: z.enum(['due_on_receipt', 'net_15', 'net_30']).optional(),
});

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

interface WorkspaceRow { id: string; token_hash: string; invoice_json: string; mode: Mode; focus: FocusTarget | null }
interface ActionRow { id: string; operation: EditOperation; request_id: string; source: string; before_json: string; after_json: string; receipt_json: string; undone_by: string | null }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const validationEventSchema = z.object({
  kind: z.enum(['session_started', 'session_stopped', 'turn', 'assistant_error', 'helpful_yes', 'helpful_no']),
  channel: z.enum(['voice', 'text']).nullable(),
});
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(100),
  email: z.email().max(254),
});
const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  priceCents: z.number().int().min(1).max(100_000_000),
});

export class Store {
  readonly db: DatabaseSync;
  constructor(path = ':memory:', private options: { seedCatalog?: boolean } = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, invoice_json TEXT NOT NULL,
      mode TEXT NOT NULL, focus TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, request_id TEXT NOT NULL,
      operation TEXT NOT NULL, source TEXT NOT NULL, before_json TEXT NOT NULL,
      after_json TEXT NOT NULL, receipt_json TEXT NOT NULL, undone_by TEXT,
      UNIQUE(workspace_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS actions_by_workspace ON actions(workspace_id);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS validation_events (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL,
      channel TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS validation_events_by_workspace ON validation_events(workspace_id);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS pilot_invites (
      invite_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS pilot_sessions (
      token_hash TEXT PRIMARY KEY, invite_hash TEXT NOT NULL REFERENCES pilot_invites(invite_hash),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pilot_sessions_expiry ON pilot_sessions(expires_at);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL, city TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customers_by_workspace ON customers(workspace_id);
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL, price_cents INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS products_by_workspace ON products(workspace_id);`);
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version < 1) {
      const existing = this.db.prepare('SELECT id FROM workspaces').all() as { id: string }[];
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of existing) this.seedFixtures(row.id);
        this.db.exec('PRAGMA user_version = 1');
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }

  private seedFixtures(workspaceId: string): void {
    const now = new Date().toISOString();
    const customerInsert = this.db.prepare('INSERT OR IGNORE INTO customers VALUES (?, ?, ?, ?, ?, ?)');
    const productInsert = this.db.prepare('INSERT OR IGNORE INTO products VALUES (?, ?, ?, ?, ?, ?)');
    for (const customer of CUSTOMERS) customerInsert.run(`${workspaceId}:${customer.id}`, workspaceId, customer.name, customer.city, customer.email, now);
    for (const product of PRODUCTS) productInsert.run(`${workspaceId}:${product.id}`, workspaceId, product.name, product.priceCents, product.description, now);
  }

  private customers(workspaceId: string): Customer[] {
    const rows = this.db.prepare('SELECT id, name, city, email FROM customers WHERE workspace_id = ? ORDER BY name COLLATE NOCASE')
      .all(workspaceId) as { id: string; name: string; city: string; email: string }[];
    return rows.map((row) => ({ ...row, id: row.id.startsWith(`${workspaceId}:`) ? row.id.slice(workspaceId.length + 1) : row.id }));
  }

  private products(workspaceId: string): Product[] {
    const rows = this.db.prepare('SELECT id, name, price_cents, description FROM products WHERE workspace_id = ? ORDER BY name COLLATE NOCASE')
      .all(workspaceId) as { id: string; name: string; price_cents: number; description: string }[];
    return rows.map((row) => ({ id: row.id.startsWith(`${workspaceId}:`) ? row.id.slice(workspaceId.length + 1) : row.id,
      name: row.name, priceCents: row.price_cents, description: row.description }));
  }

  createWorkspace(): string {
    const token = randomBytes(32).toString('base64url');
    this.insertWorkspace(token);
    return token;
  }

  private insertWorkspace(token: string): string {
    const id = randomUUID();
    const invoice: Invoice = {
      id: randomUUID(), revision: 0, customerId: null, items: [], deliveryCents: 0,
      terms: 'due_on_receipt', issueDate: new Date().toISOString().slice(0, 10),
      status: 'draft', savedAt: null,
    };
    this.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, hash(token), JSON.stringify(invoice), 'collaborate', null, new Date().toISOString());
    if (this.options.seedCatalog !== false) this.seedFixtures(id);
    return id;
  }

  signInInvite(inviteHash: string): string {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let invite = this.db.prepare('SELECT workspace_id FROM pilot_invites WHERE invite_hash = ?')
        .get(inviteHash) as { workspace_id: string } | undefined;
      if (!invite) {
        const workspaceId = this.insertWorkspace(randomBytes(32).toString('base64url'));
        this.db.prepare('INSERT INTO pilot_invites VALUES (?, ?)').run(inviteHash, workspaceId);
        invite = { workspace_id: workspaceId };
      }
      const token = randomBytes(32).toString('base64url');
      this.db.prepare('DELETE FROM pilot_sessions WHERE expires_at <= ?').run(Date.now());
      this.db.prepare('INSERT INTO pilot_sessions VALUES (?, ?, ?)')
        .run(hash(token), inviteHash, Date.now() + 7 * 24 * 60 * 60 * 1000);
      this.db.exec('COMMIT');
      return token;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  pilotInviteForSession(token: string): string | null {
    const row = this.db.prepare('SELECT invite_hash FROM pilot_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hash(token), Date.now()) as { invite_hash: string } | undefined;
    return row?.invite_hash ?? null;
  }

  revokePilotSession(token: string): void {
    this.db.prepare('DELETE FROM pilot_sessions WHERE token_hash = ?').run(hash(token));
  }

  exportPilotWorkspace(token: string) {
    const inviteHash = this.pilotInviteForSession(token);
    if (!inviteHash) throw new AppError(401, 'unauthorized', 'Sign in to export your workspace.');
    const workspace = this.row(token);
    const actions = this.db.prepare('SELECT operation, source, before_json, after_json, receipt_json FROM actions WHERE workspace_id = ? ORDER BY rowid')
      .all(workspace.id) as { operation: string; source: string; before_json: string; after_json: string; receipt_json: string }[];
    const events = this.db.prepare('SELECT kind, channel, created_at FROM validation_events WHERE workspace_id = ? ORDER BY created_at')
      .all(workspace.id);
    return {
      exportedAt: new Date().toISOString(),
      invoice: JSON.parse(workspace.invoice_json) as Invoice,
      customers: this.customers(workspace.id),
      products: this.products(workspace.id),
      mode: workspace.mode,
      actions: actions.map((action) => ({
        operation: action.operation, source: action.source,
        before: JSON.parse(action.before_json) as Invoice,
        after: JSON.parse(action.after_json) as Invoice,
        receipt: JSON.parse(action.receipt_json) as Receipt,
      })),
      validationEvents: events,
    };
  }

  deletePilotWorkspace(token: string): void {
    const inviteHash = this.pilotInviteForSession(token);
    if (!inviteHash) throw new AppError(401, 'unauthorized', 'Sign in to delete your workspace.');
    const workspace = this.row(token);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM pilot_sessions WHERE invite_hash = ?').run(inviteHash);
      this.db.prepare('DELETE FROM validation_events WHERE workspace_id = ?').run(workspace.id);
      this.db.prepare('DELETE FROM actions WHERE workspace_id = ?').run(workspace.id);
      this.db.prepare('DELETE FROM customers WHERE workspace_id = ?').run(workspace.id);
      this.db.prepare('DELETE FROM products WHERE workspace_id = ?').run(workspace.id);
      this.db.prepare('DELETE FROM pilot_invites WHERE invite_hash = ?').run(inviteHash);
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspace.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private row(token: string): WorkspaceRow {
    const row = this.db.prepare(`SELECT w.* FROM workspaces w WHERE w.token_hash = ?
      UNION ALL SELECT w.* FROM workspaces w JOIN pilot_invites i ON i.workspace_id = w.id
      JOIN pilot_sessions s ON s.invite_hash = i.invite_hash
      WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`)
      .get(hash(token), hash(token), Date.now()) as unknown as WorkspaceRow | undefined;
    if (!row) throw new AppError(401, 'unauthorized', 'Session expired. Refresh to start a new workspace.');
    return row;
  }

  workspaceId(token: string): string { return this.row(token).id; }

  hasWorkspace(token: string): boolean {
    return Boolean(this.db.prepare('SELECT id FROM workspaces WHERE token_hash = ?').get(hash(token)));
  }

  recordValidationEvent(token: string, unknownEvent: unknown): void {
    const parsed = validationEventSchema.safeParse(unknownEvent);
    if (!parsed.success) throw new AppError(400, 'invalid_validation_event', 'Unsupported validation event.');
    const workspace = this.row(token);
    const { kind, channel } = parsed.data;
    if (kind.startsWith('helpful_')) {
      this.db.prepare("DELETE FROM validation_events WHERE workspace_id = ? AND kind IN ('helpful_yes', 'helpful_no')")
        .run(workspace.id);
    }
    this.db.prepare('INSERT INTO validation_events VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), workspace.id, kind, channel, new Date().toISOString());
  }

  validationReport() {
    const count = (sql: string) => (this.db.prepare(sql).get() as { total: number }).total;
    return {
      voiceSessions: count("SELECT COUNT(*) AS total FROM validation_events WHERE kind = 'session_started' AND channel = 'voice'"),
      textSessions: count("SELECT COUNT(*) AS total FROM validation_events WHERE kind = 'session_started' AND channel = 'text'"),
      userTurns: count("SELECT COUNT(*) AS total FROM validation_events WHERE kind = 'turn'"),
      assistantErrors: count("SELECT COUNT(*) AS total FROM validation_events WHERE kind = 'assistant_error'"),
      draftsSaved: count("SELECT COUNT(DISTINCT workspace_id) AS total FROM actions WHERE operation = 'save_draft'"),
      agentEditedDrafts: count("SELECT COUNT(DISTINCT workspace_id) AS total FROM actions WHERE source = 'agent' AND operation NOT IN ('undo', 'save_draft')"),
      feedbackHelpful: count("SELECT COUNT(*) AS total FROM validation_events WHERE kind = 'helpful_yes'"),
      feedbackNeedsWork: count("SELECT COUNT(*) AS total FROM validation_events WHERE kind = 'helpful_no'"),
    };
  }

  getState(token: string): AppState {
    const row = this.row(token);
    const last = this.db.prepare('SELECT receipt_json FROM actions WHERE workspace_id = ? ORDER BY rowid DESC LIMIT 1').get(row.id) as { receipt_json: string } | undefined;
    return {
      invoice: JSON.parse(row.invoice_json) as Invoice,
      customers: this.customers(row.id), products: this.products(row.id), mode: row.mode, focus: row.focus,
      lastAction: last ? JSON.parse(last.receipt_json) as Receipt : null,
    };
  }

  addCustomer(token: string, unknownCustomer: unknown): { state: AppState; customer: Customer } {
    const parsed = customerSchema.safeParse(unknownCustomer);
    if (!parsed.success) throw new AppError(400, 'invalid_customer', 'Enter a name, city, and valid email address.');
    const workspace = this.row(token);
    if (this.customers(workspace.id).length >= 100) throw new AppError(400, 'catalog_limit', 'This workspace has reached 100 customers.');
    const { name, city, email } = parsed.data;
    const duplicate = this.db.prepare('SELECT 1 FROM customers WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(workspace.id, name);
    if (duplicate) throw new AppError(409, 'duplicate_customer', 'A customer with this name already exists.');
    const customer: Customer = { id: randomUUID(), name, city, email };
    this.db.prepare('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?)')
      .run(customer.id, workspace.id, name, city, email, new Date().toISOString());
    return { state: this.getState(token), customer };
  }

  addProduct(token: string, unknownProduct: unknown): { state: AppState; product: Product } {
    const parsed = productSchema.safeParse(unknownProduct);
    if (!parsed.success) throw new AppError(400, 'invalid_product', 'Enter a product name and a price greater than zero.');
    const workspace = this.row(token);
    if (this.products(workspace.id).length >= 100) throw new AppError(400, 'catalog_limit', 'This workspace has reached 100 products.');
    const { name, description, priceCents } = parsed.data;
    const duplicate = this.db.prepare('SELECT 1 FROM products WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(workspace.id, name);
    if (duplicate) throw new AppError(409, 'duplicate_product', 'A product with this name already exists.');
    const product: Product = { id: randomUUID(), name, description, priceCents };
    this.db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)')
      .run(product.id, workspace.id, name, priceCents, description, new Date().toISOString());
    return { state: this.getState(token), product };
  }

  setMode(token: string, mode: Mode): AppState {
    if (!['guide', 'collaborate', 'delegate', 'manual'].includes(mode)) throw new AppError(400, 'invalid_mode', 'Choose a supported mode.');
    const row = this.row(token);
    this.db.prepare('UPDATE workspaces SET mode = ?, updated_at = ? WHERE id = ?').run(mode, new Date().toISOString(), row.id);
    return this.getState(token);
  }

  setFocus(token: string, focus: FocusTarget | null): AppState {
    if (focus !== null && !['customer', 'items', 'delivery', 'terms', 'preview'].includes(focus)) throw new AppError(400, 'invalid_focus', 'Choose a supported field.');
    const row = this.row(token);
    this.db.prepare('UPDATE workspaces SET focus = ?, updated_at = ? WHERE id = ?').run(focus, new Date().toISOString(), row.id);
    return this.getState(token);
  }

  edit(token: string, unknownRequest: unknown): EditResult {
    const parsed = requestSchema.safeParse(unknownRequest);
    if (!parsed.success) throw new AppError(400, 'invalid_request', parsed.error.issues.map((issue) => issue.message).join('; '));
    const request: EditRequest = parsed.data;
    const row = this.row(token);
    const previous = this.db.prepare('SELECT receipt_json FROM actions WHERE workspace_id = ? AND request_id = ?')
      .get(row.id, request.requestId) as { receipt_json: string } | undefined;
    if (previous) return { state: this.getState(token), receipt: JSON.parse(previous.receipt_json) as Receipt };
    if (request.source === 'agent' && (row.mode === 'guide' || row.mode === 'manual')) {
      throw new AppError(403, 'mode_disallows_action', `Current mode is ${row.mode}; switch to Do it with me or Do it for me before editing.`);
    }
    const before = JSON.parse(row.invoice_json) as Invoice;
    const customers = this.customers(row.id);
    const products = this.products(row.id);
    if (request.expectedRevision !== before.revision) {
      throw new AppError(409, 'stale_revision', `Invoice changed. Current revision is ${before.revision}; read it again before editing.`);
    }
    const after = clone(before);
    let summary = '';
    let undoneActionId: string | null = null;

    switch (request.operation) {
      case 'select_customer': {
        const customer = customers.find((item) => item.id === request.customerId);
        if (!customer) throw new AppError(400, 'unknown_customer', 'Customer not found. Choose an existing customer.');
        after.customerId = customer.id;
        summary = `Selected ${customer.name}`;
        break;
      }
      case 'upsert_item': {
        const product = products.find((item) => item.id === request.productId);
        if (!product) throw new AppError(400, 'unknown_product', 'Product not found. Choose a catalog product.');
        if (!request.quantity) throw new AppError(400, 'missing_quantity', 'Ask for the item quantity.');
        const existing = after.items.find((item) => item.productId === product.id);
        if (existing) existing.quantity = request.quantity;
        else after.items.push({ id: randomUUID(), productId: product.id, quantity: request.quantity });
        summary = `${request.quantity} × ${product.name}`;
        break;
      }
      case 'remove_item': {
        const existing = after.items.find((item) => item.id === request.itemId || item.productId === request.productId);
        if (!existing) throw new AppError(400, 'unknown_item', 'Item is not on this invoice.');
        after.items = after.items.filter((item) => item.id !== existing.id);
        summary = `Removed ${products.find((item) => item.id === existing.productId)?.name ?? 'item'}`;
        break;
      }
      case 'set_delivery': {
        if (request.deliveryCents === undefined) throw new AppError(400, 'missing_delivery', 'Ask for a delivery amount in rupees.');
        after.deliveryCents = request.deliveryCents;
        summary = `Delivery set to ₹${(request.deliveryCents / 100).toLocaleString('en-IN')}`;
        break;
      }
      case 'set_terms': {
        if (!request.terms) throw new AppError(400, 'missing_terms', 'Choose due on receipt, Net 15, or Net 30.');
        after.terms = request.terms;
        summary = `Payment terms set to ${request.terms === 'due_on_receipt' ? 'Due on receipt' : request.terms === 'net_15' ? 'Net 15' : 'Net 30'}`;
        break;
      }
      case 'save_draft': {
        if (!after.customerId || after.items.length === 0) throw new AppError(400, 'incomplete_invoice', 'Choose a customer and at least one item before saving.');
        after.status = 'saved';
        after.savedAt = new Date().toISOString();
        summary = `Draft saved as ${after.id.slice(0, 8).toUpperCase()}`;
        break;
      }
      case 'undo': {
        const action = this.db.prepare(`SELECT * FROM actions WHERE workspace_id = ? AND source = 'agent'
          AND operation NOT IN ('undo', 'save_draft') AND undone_by IS NULL ORDER BY rowid DESC LIMIT 1`)
          .get(row.id) as unknown as ActionRow | undefined;
        if (!action) throw new AppError(400, 'nothing_to_undo', 'There is no agent edit to undo.');
        const old = JSON.parse(action.before_json) as Invoice;
        const applied = JSON.parse(action.after_json) as Invoice;
        switch (action.operation) {
          case 'select_customer':
            if (after.customerId !== applied.customerId) throw new AppError(409, 'undo_conflict', 'Customer changed again. Choose the customer you want.');
            after.customerId = old.customerId; break;
          case 'set_delivery':
            if (after.deliveryCents !== applied.deliveryCents) throw new AppError(409, 'undo_conflict', 'Delivery changed again. Choose the amount you want.');
            after.deliveryCents = old.deliveryCents; break;
          case 'set_terms':
            if (after.terms !== applied.terms) throw new AppError(409, 'undo_conflict', 'Payment terms changed again. Choose the terms you want.');
            after.terms = old.terms; break;
          case 'upsert_item': case 'remove_item': {
            const changed = [...old.items, ...applied.items].find((item) => {
              const left = old.items.find((x) => x.productId === item.productId);
              const right = applied.items.find((x) => x.productId === item.productId);
              return JSON.stringify(left) !== JSON.stringify(right);
            });
            if (!changed) throw new AppError(409, 'undo_conflict', 'Item history changed.');
            const current = after.items.find((item) => item.productId === changed.productId);
            const prior = old.items.find((item) => item.productId === changed.productId);
            const expected = applied.items.find((item) => item.productId === changed.productId);
            if (JSON.stringify(current) !== JSON.stringify(expected)) throw new AppError(409, 'undo_conflict', 'That item changed again. Choose its quantity explicitly.');
            after.items = after.items.filter((item) => item.productId !== changed.productId);
            if (prior) after.items.push(prior);
            break;
          }
          default: throw new AppError(400, 'nothing_to_undo', 'This action cannot be undone.');
        }
        undoneActionId = action.id;
        summary = `Undid ${action.operation.replaceAll('_', ' ')}`;
        break;
      }
    }

    after.revision++;
    if (request.operation !== 'save_draft' && before.status === 'saved') { after.status = 'draft'; after.savedAt = null; }
    const receipt: Receipt = {
      id: randomUUID(), operation: request.operation, beforeRevision: before.revision,
      afterRevision: after.revision, summary, totalCents: calculateTotal(after, products), createdAt: new Date().toISOString(),
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT invoice_json FROM workspaces WHERE id = ?').get(row.id) as { invoice_json: string };
      if ((JSON.parse(current.invoice_json) as Invoice).revision !== before.revision) throw new AppError(409, 'stale_revision', 'Invoice changed during this action. Refresh and retry.');
      this.db.prepare('UPDATE workspaces SET invoice_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(after), new Date().toISOString(), row.id);
      this.db.prepare('INSERT INTO actions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(receipt.id, row.id, request.requestId, request.operation, request.source,
          JSON.stringify(before), JSON.stringify(after), JSON.stringify(receipt), null);
      if (undoneActionId) this.db.prepare('UPDATE actions SET undone_by = ? WHERE id = ?').run(receipt.id, undoneActionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { state: this.getState(token), receipt };
  }
}
