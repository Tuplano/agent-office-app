import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { OfficeStateSchema } from '../shared/state';
import type { StateSource } from './source';

// The Rust side collects the state. It sends one whenever something changes, and
// hands over the latest on request, which is what the first paint uses.
export const tauriSource: StateSource = {
  subscribe(onState, onStatus) {
    let open = true;
    let heard = false; // a state has been sent, so the one asked for is already old

    const accept = (payload: unknown) => {
      if (!open) return;
      const parsed = OfficeStateSchema.safeParse(payload);
      if (!parsed.success) {
        console.error('Agent Office: a state arrived that could not be read', parsed.error);
        onStatus(false);
        return;
      }
      onState(parsed.data);
      onStatus(true);
    };

    // listening first, so no change falls between the first state and the next
    const listening = listen('state', (event) => {
      heard = true;
      accept(event.payload);
    });
    listening
      .then(() => invoke('get_state'))
      .then((first) => {
        if (!heard) accept(first);
      })
      .catch((err: unknown) => {
        console.error('Agent Office: the state could not be fetched', err);
        if (open) onStatus(false);
      });

    return () => {
      open = false;
      listening.then((stop) => stop()).catch(() => {});
    };
  },
};
