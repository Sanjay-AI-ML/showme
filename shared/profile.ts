import type { Mode } from './types.js';

export type ProfileField = 'name' | 'email' | 'phone' | 'preferredContact' | 'notes';
export interface CustomerProfile {
  name: string;
  email: string;
  phone: string;
  preferredContact: 'email' | 'phone';
  notes: string;
}
export interface ProfileState {
  profile: CustomerProfile;
  revision: number;
  mode: Mode;
  lastAction: { field: ProfileField | 'undo'; before: string; after: string; source: 'agent' | 'manual' } | null;
  recentActions: ProfileActionSummary[];
  task: ProfileTask;
}
export interface ProfileActionSummary {
  id: string;
  field: ProfileField | 'undo';
  targetField: ProfileField;
  before: string;
  after: string;
  source: 'agent' | 'manual';
  undone: boolean;
}
export interface ProfileTask {
  complete: boolean;
  steps: { id: 'name' | 'contact' | 'preference'; label: string; complete: boolean }[];
  nextStep: string | null;
}
export interface ProfileEdit {
  field: ProfileField | 'undo';
  value?: string;
  expectedRevision: number;
  requestId: string;
  source: 'agent' | 'manual';
}
