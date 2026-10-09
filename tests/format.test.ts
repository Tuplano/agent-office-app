import { describe, expect, it } from 'vitest';
import { ago, plural, shortPath } from '../src/lib/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_760_000_000_000;

describe('plural', () => {
  it('adds an s to anything but one', () => {
    expect(plural(0, 'session')).toBe('0 sessions');
    expect(plural(1, 'session')).toBe('1 session');
    expect(plural(2, 'intern')).toBe('2 interns');
  });
});

describe('ago', () => {
  it('says nothing for a time that is not known', () => {
    expect(ago(null, NOW)).toBe('');
    expect(ago(0, NOW)).toBe('');
  });

  it('counts in the two largest units', () => {
    expect(ago(NOW - 59_000, NOW)).toBe('<1m');
    expect(ago(NOW - MINUTE, NOW)).toBe('1m');
    expect(ago(NOW - 59 * MINUTE, NOW)).toBe('59m');
    expect(ago(NOW - HOUR, NOW)).toBe('1h 0m');
    expect(ago(NOW - (23 * HOUR + 59 * MINUTE), NOW)).toBe('23h 59m');
    expect(ago(NOW - 24 * HOUR, NOW)).toBe('1d 0h');
    expect(ago(NOW - (3 * 24 + 5) * HOUR, NOW)).toBe('3d 5h');
  });

  it('goes by the clock when not given the time', () => {
    expect(ago(Date.now() - 5 * MINUTE)).toBe('5m');
  });
});

describe('shortPath', () => {
  it('writes the home folder as ~', () => {
    expect(shortPath('/home/sam', '/home/sam')).toBe('~');
    expect(shortPath('/home/sam/notes', '/home/sam')).toBe('~/notes');
    expect(shortPath('/home/sam/code/app', '/home/sam')).toBe('~/code/app');
  });

  it('keeps only the last two parts of a deep folder', () => {
    expect(shortPath('/home/sam/code/work/app', '/home/sam')).toBe('…/work/app');
    expect(shortPath('/srv/www/site/public', '/home/sam')).toBe('…/site/public');
  });

  it('leaves other folders alone, and one that only starts like home', () => {
    expect(shortPath('/srv/www', '/home/sam')).toBe('/srv/www');
    expect(shortPath('/home/samantha', '/home/sam')).toBe('/home/samantha');
    // with no home known, nothing is written as ~
    expect(shortPath('/home/sam', '')).toBe('/home/sam');
    expect(shortPath('/home/sam/notes', '')).toBe('…/sam/notes');
  });
});
