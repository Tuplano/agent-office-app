import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/data/conversation';
import { turnsOf } from '../src/lib/turns';

const said = (id: string, fromUser: boolean, text: string): Entry => ({ id, fromUser, text, tool: null });
const did = (id: string, name: string): Entry => ({ id, fromUser: false, text: null, tool: { name, note: null } });

describe('the turns of a conversation', () => {
  it('are runs of entries by the same side, each known by its first', () => {
    const entries = [said('u1#0', true, 'fix it'), said('a1#0', false, 'On it.'), did('a1#1', 'Edit'), did('a2#0', 'Bash'), said('a3#0', false, 'Done.'), said('u2#0', true, 'thanks')];
    const turns = turnsOf(entries);
    expect(turns.map((turn) => [turn.id, turn.fromUser, turn.entries.length])).toEqual([
      ['u1#0', true, 1],
      ['a1#0', false, 4],
      ['u2#0', true, 1],
    ]);
  });

  it('are none for nothing said', () => {
    expect(turnsOf([])).toEqual([]);
  });
});

describe('what came since, added to what was shown', () => {
  it('goes on the end, and an entry shown already takes the place of the one before', async () => {
    const { withLater } = await import('../src/components/Conversation');
    const shown = [said('1#0', true, 'go'), said('2#0', false, 'Hal')];
    const next = withLater(shown, [said('2#0', false, 'Half done'), did('3#0', 'run_command')]);
    expect(next.map((e) => e.text ?? e.tool?.name)).toEqual(['go', 'Half done', 'run_command']);
    expect(shown[1].text).toBe('Hal');
  });
});
