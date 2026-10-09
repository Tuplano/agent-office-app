import type { OfficeState } from '../shared/state';

// Where the office state comes from. A source hands over each new state, and says
// whether it is still in touch with whatever it reads.
export interface StateSource {
  // returns the way to unsubscribe
  subscribe(
    onState: (state: OfficeState) => void,
    onStatus: (connected: boolean) => void,
  ): () => void;
}
