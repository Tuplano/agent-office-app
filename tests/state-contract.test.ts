// The Rust side serializes its structs to this same fixture (the test in
// `src-tauri/src/state.rs`), so a field changed on one side only fails here or there.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OfficeStateSchema } from '../src/shared/state';

const fixture: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'),
);

describe('the state contract', () => {
  it('reads what the Rust side sends, with no field left over', () => {
    // a field the schema does not know would be dropped, and the two would differ
    expect(OfficeStateSchema.parse(fixture)).toEqual(fixture);
  });

  it('turns down a state with a field missing or mistyped', () => {
    const state = structuredClone(fixture) as { sessions: Record<string, unknown>[] };
    delete state.sessions[0].agentsSpawned;
    expect(OfficeStateSchema.safeParse(state).success).toBe(false);

    const other = structuredClone(fixture) as { sessions: Record<string, unknown>[] };
    other.sessions[1].status = 'sleeping';
    expect(OfficeStateSchema.safeParse(other).success).toBe(false);
  });
});
