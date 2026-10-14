import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewSession } from '../src/components/NewSession';
import { folderChoices, rememberedFolders, rememberFolder } from '../src/lib/folders';
import type { Session } from '../src/shared/state';

describe('the new session box', () => {
  const box = (folders: string[]) => renderToStaticMarkup(<NewSession folders={folders} home="/home/sam" onStarted={() => {}} />);

  it('looks for the tools first, and cannot start before one is chosen', () => {
    const html = box(['/home/sam/code/jobfind']);
    expect(html).toContain('<span class="dim">Looking…</span>');
    expect(html).toContain('<button type="button" class="primary" disabled="">Start</button>');
  });

  it('offers the folders, shortened, the first one chosen, and a way to browse for another', () => {
    const html = box(['/home/sam/code/jobfind', '/srv/site']);
    expect(html).toContain('<option value="/home/sam/code/jobfind" selected="">~/code/jobfind</option><option value="/srv/site">/srv/site</option>');
    expect(html).toContain('<button type="button">Browse…</button>');
  });

  it('has only the way to browse when there is no folder to offer', () => {
    const html = box([]);
    expect(html).not.toContain('<select');
    expect(html).toContain('Browse…');
  });
});

describe('the folders a session can start in', () => {
  const at = (cwd: string) => ({ cwd }) as Session;

  it('are those used before, newest first, then those of the sessions open now, each once', () => {
    expect(folderChoices(['/b', '/a'], [at('/a'), at('/c'), at('/c')])).toEqual(['/b', '/a', '/c']);
  });

  describe('as remembered', () => {
    afterEach(() => vi.unstubAllGlobals());
    const storage = () => {
      const held = new Map<string, string>();
      return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => held.set(key, value) };
    };

    it('put the one used last first, once, and keep eight', () => {
      vi.stubGlobal('localStorage', storage());
      for (let i = 1; i <= 9; i++) rememberFolder(`/f${i}`);
      rememberFolder('/f5');
      expect(rememberedFolders()).toEqual(['/f5', '/f9', '/f8', '/f7', '/f6', '/f4', '/f3', '/f2']);
    });

    it('are none when storage is off or holds something else', () => {
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('off'); }, setItem: () => { throw new Error('off'); } });
      rememberFolder('/a');
      expect(rememberedFolders()).toEqual([]);
      vi.stubGlobal('localStorage', { getItem: () => '{"not":"a list"}' });
      expect(rememberedFolders()).toEqual([]);
    });
  });
});
