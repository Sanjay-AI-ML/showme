import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Mode } from '../shared/types.js';
import type { CustomerProfile, ProfileActionSummary, ProfileEdit, ProfileField, ProfileState, ProfileTask } from '../shared/profile.js';
import { AppError } from './store.js';

const modeSchema = z.enum(['guide', 'collaborate', 'delegate', 'manual']);
const editSchema = z.object({
  field: z.enum(['name', 'email', 'phone', 'preferredContact', 'notes', 'undo']),
  value: z.string().optional(),
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().min(6).max(128),
  source: z.enum(['agent', 'manual']),
});
const values: Record<ProfileField, z.ZodType<string>> = {
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,24}$/, 'Enter a valid phone number.'),
  preferredContact: z.enum(['email', 'phone']),
  notes: z.string().trim().max(500),
};
const initial: CustomerProfile = { name: '', email: '', phone: '', preferredContact: 'email', notes: '' };
type Row = { profile_json: string; revision: number; mode: Mode };
type Action = { id: string; field: ProfileField; before_value: string; after_value: string; source: 'agent' | 'manual'; undone_by: string | null };

export function profileTask(profile: CustomerProfile): ProfileTask {
  const steps: ProfileTask['steps'] = [
    { id: 'name', label: 'Add a customer name', complete: Boolean(profile.name.trim()) },
    { id: 'contact', label: 'Add an email or phone number', complete: Boolean(profile.email || profile.phone) },
    { id: 'preference', label: 'Make the preferred contact usable', complete: Boolean(profile[profile.preferredContact]) },
  ];
  return { complete: steps.every((step) => step.complete), steps,
    nextStep: steps.find((step) => !step.complete)?.label ?? null };
}

/** Independent host domain, keyed to the authenticated ShowMe workspace. */
export class ProfileStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS customer_profiles (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      profile_json TEXT NOT NULL, revision INTEGER NOT NULL, mode TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_actions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, field TEXT NOT NULL, before_value TEXT NOT NULL,
      after_value TEXT NOT NULL, source TEXT NOT NULL, undone_by TEXT,
      UNIQUE(workspace_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS profile_actions_workspace ON profile_actions(workspace_id);`);
  }

  private row(workspaceId: string): Row {
    this.db.prepare('INSERT OR IGNORE INTO customer_profiles VALUES (?, ?, 0, ?)')
      .run(workspaceId, JSON.stringify(initial), 'collaborate');
    return this.db.prepare('SELECT * FROM customer_profiles WHERE workspace_id = ?').get(workspaceId) as Row;
  }

  getState(workspaceId: string): ProfileState {
    const row = this.row(workspaceId);
    const profile = JSON.parse(row.profile_json) as CustomerProfile;
    const actions = this.db.prepare(`SELECT a.id, a.field, COALESCE(original.field, a.field) AS target_field,
      a.before_value, a.after_value, a.source, a.undone_by
      FROM profile_actions a LEFT JOIN profile_actions original ON original.undone_by = a.id
      WHERE a.workspace_id = ? ORDER BY a.rowid DESC LIMIT 8`).all(workspaceId) as
      { id: string; field: ProfileField | 'undo'; target_field: ProfileField; before_value: string; after_value: string; source: 'agent' | 'manual'; undone_by: string | null }[];
    const recentActions: ProfileActionSummary[] = actions.map((action) => ({ id: action.id, field: action.field,
      targetField: action.target_field, before: action.before_value, after: action.after_value,
      source: action.source, undone: Boolean(action.undone_by) }));
    const action = recentActions[0];
    return { profile, revision: row.revision, mode: row.mode, task: profileTask(profile), recentActions,
      lastAction: action ? { field: action.field, before: action.before, after: action.after, source: action.source } : null };
  }

  export(workspaceId: string) {
    return { state: this.getState(workspaceId), actions: this.db.prepare(
      'SELECT field, before_value AS before, after_value AS after, source FROM profile_actions WHERE workspace_id = ? ORDER BY rowid'
    ).all(workspaceId) };
  }

  setMode(workspaceId: string, input: unknown): ProfileState {
    const parsed = modeSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'invalid_mode', 'Choose a valid assistance mode.');
    this.row(workspaceId);
    this.db.prepare('UPDATE customer_profiles SET mode = ? WHERE workspace_id = ?').run(parsed.data, workspaceId);
    return this.getState(workspaceId);
  }

  edit(workspaceId: string, input: unknown): { state: ProfileState; applied: boolean } {
    const parsed = editSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'invalid_edit', 'That profile edit is invalid.');
    const edit: ProfileEdit = parsed.data;
    const existing = this.db.prepare('SELECT id FROM profile_actions WHERE workspace_id = ? AND request_id = ?').get(workspaceId, edit.requestId);
    if (existing) return { state: this.getState(workspaceId), applied: false };
    const row = this.row(workspaceId);
    if (row.revision !== edit.expectedRevision) throw new AppError(409, 'stale_revision', 'The profile changed. Review it and try again.');
    if (edit.source === 'agent' && (row.mode === 'guide' || row.mode === 'manual'))
      throw new AppError(403, 'mode_disallows_edit', 'Switch to Do it with me or Do it for me to allow edits.');
    const profile = JSON.parse(row.profile_json) as CustomerProfile;
    const actionId = randomUUID();
    let field: ProfileField | 'undo' = edit.field;
    let before: string;
    let after: string;
    let undoId: string | null = null;
    if (field === 'undo') {
      if (edit.source !== 'agent') throw new AppError(400, 'invalid_undo', 'Use the assistant to undo its last edit.');
      const action = this.db.prepare("SELECT * FROM profile_actions WHERE workspace_id = ? AND source = 'agent' AND field != 'undo' AND undone_by IS NULL ORDER BY rowid DESC LIMIT 1")
        .get(workspaceId) as Action | undefined;
      if (!action) throw new AppError(400, 'nothing_to_undo', 'There is no assistant edit to undo.');
      if (profile[action.field] !== action.after_value) throw new AppError(409, 'undo_conflict', 'That field changed again. Tell me the value you want.');
      before = action.after_value;
      after = action.before_value;
      profile[action.field] = after as never;
      undoId = action.id;
    } else {
      if (edit.value === undefined) throw new AppError(400, 'missing_value', 'Provide a value for this field.');
      const value = values[field].safeParse(edit.value);
      if (!value.success) throw new AppError(400, 'invalid_value', value.error.issues[0]?.message ?? 'Invalid value.');
      before = profile[field];
      after = value.data;
      if (before === after) return { state: this.getState(workspaceId), applied: false };
      profile[field] = after as never;
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.db.prepare('UPDATE customer_profiles SET profile_json = ?, revision = revision + 1 WHERE workspace_id = ? AND revision = ?')
        .run(JSON.stringify(profile), workspaceId, row.revision);
      if (!updated.changes) throw new AppError(409, 'stale_revision', 'The profile changed. Review it and try again.');
      this.db.prepare('INSERT INTO profile_actions VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(actionId, workspaceId, edit.requestId, field, before, after, edit.source);
      if (undoId) this.db.prepare('UPDATE profile_actions SET undone_by = ? WHERE id = ?').run(actionId, undoId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { state: this.getState(workspaceId), applied: true };
  }
}
