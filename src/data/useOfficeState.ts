import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { OfficeState } from '../shared/state';
import type { StateSource } from './source';
import { tauriSource } from './tauri-source';

const STATE_KEY = ['office', 'state'];
const CONNECTED_KEY = ['office', 'connected'];
const NOBODY: OfficeState = { home: '', sessions: [] };

// Nothing fetches these: the feed below puts every value in the cache itself.
const pushed = { queryFn: skipToken, staleTime: Infinity, gcTime: Infinity } as const;

// Subscribes to the source and keeps the cache up to date with it. Mount it once,
// at the root; anything that needs the state reads it with `useOfficeState`.
export function useOfficeFeed(source: StateSource = tauriSource) {
  const client = useQueryClient();
  useEffect(
    () =>
      source.subscribe(
        (state) => client.setQueryData(STATE_KEY, state),
        (connected) => client.setQueryData(CONNECTED_KEY, connected),
      ),
    [client, source],
  );
}

// connecting until the source has said anything; lost when it cannot be read
export type FeedStatus = 'connecting' | 'connected' | 'lost';

// The office as last reported, and whether the source is still in touch.
export function useOfficeState() {
  const state = useQuery<OfficeState>({ queryKey: STATE_KEY, ...pushed });
  const connected = useQuery<boolean>({ queryKey: CONNECTED_KEY, ...pushed });
  const status: FeedStatus = connected.data === undefined ? 'connecting' : connected.data ? 'connected' : 'lost';
  return { state: state.data ?? NOBODY, connected: status === 'connected', status };
}
