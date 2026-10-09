export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// How long ago a time was, in its two largest units; nothing for a time that is not known.
export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return '';
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ${mins % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// A folder told briefly: ~ for the home folder, and only the last two parts of a deep one.
export function shortPath(cwd: string, home: string): string {
  let p = cwd;
  if (home && (p === home || p.startsWith(`${home}/`))) p = `~${p.slice(home.length)}`;
  const parts = p.split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p;
}
