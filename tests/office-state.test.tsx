import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useOfficeState } from '../src/data/useOfficeState';

// what the hook says, as text, for a cache that holds `state` (or nothing)
function read(state?: { home: string; sessions: unknown[] }, connected?: boolean) {
  const client = new QueryClient();
  if (state) client.setQueryData(['office', 'state'], state);
  if (connected !== undefined) client.setQueryData(['office', 'connected'], connected);
  const Probe = () => {
    const { loaded, status, state } = useOfficeState();
    return <p>{`${loaded} ${status} ${state.sessions.length}`}</p>;
  };
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('the office state hook', () => {
  it('is not loaded until a state has arrived, whatever the connection says', () => {
    expect(read()).toBe('<p>false connecting 0</p>');
    expect(read(undefined, false)).toBe('<p>false lost 0</p>');
  });

  it('is loaded once a state is there, even an empty one', () => {
    expect(read({ home: '', sessions: [] }, true)).toBe('<p>true connected 0</p>');
    expect(read({ home: '', sessions: [{}] })).toBe('<p>true connecting 1</p>');
  });
});
