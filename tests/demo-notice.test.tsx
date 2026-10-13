// The demo line and the download link: there for the demo and nowhere else.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const choice = vi.hoisted(() => ({ isDemo: true }));
vi.mock('../src/data/choose-source', () => ({
  get isDemo() {
    return choice.isDemo;
  },
}));

import { DemoNotice, DOWNLOAD_URL } from '../src/components/DemoNotice';

describe('the demo notice', () => {
  it('says the sessions are made up and the room can be changed, and links to the downloads, in the demo', () => {
    choice.isDemo = true;
    const html = renderToStaticMarkup(<DemoNotice />);
    expect(html).toContain('these sessions are made up');
    expect(html).toContain('sessions running on your own machine');
    expect(html).toContain('The room is yours to change'); // and that is not made up
    expect(html).toContain('Edit room');
    expect(html).toContain(`href="${DOWNLOAD_URL}"`);
    expect(DOWNLOAD_URL).toBe('https://github.com/Tuplano/agent-office-app/releases');
  });

  it('is not there when the real source is in use', () => {
    choice.isDemo = false;
    expect(renderToStaticMarkup(<DemoNotice />)).toBe('');
  });
});
