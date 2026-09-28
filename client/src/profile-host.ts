import { createHostBridge } from '../../sdk/host-bridge';
import type { ProfileEdit, ProfileState } from '../../shared/profile';
import type { Mode } from '../../shared/types';
import { api } from './api';

export class ProfileHostAdapter {
  private bridge = createHostBridge<ProfileState, ProfileEdit, { state: ProfileState; applied: boolean }>({
    read: api.profileState, write: api.profileEdit, stateOf: (result) => result.state,
    revisionOf: (state) => state.revision,
  });
  getContext() { return this.bridge.getContext(); }
  execute(edit: ProfileEdit) { return this.bridge.execute(edit); }
  setMode(mode: Mode) { return this.bridge.apply(() => api.profileMode(mode), (state) => state); }
  onChange(listener: (state: ProfileState) => void) { return this.bridge.onChange(listener); }
  reset() { this.bridge.reset(); }
}
