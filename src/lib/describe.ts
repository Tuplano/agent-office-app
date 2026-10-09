import type { Session } from '../shared/state';
import { ago, plural } from './format';

// The words the page puts to the sessions: the line under the title, the window's
// own title, and the lines on each session's card.

export function summaryLine(sessions: readonly Session[]): string {
  const working = sessions.filter((s) => s.status === 'busy').length;
  const waiting = sessions.filter((s) => s.status === 'waiting').length;
  const agents = sessions.reduce((n, s) => n + s.agents.length, 0);
  const parts = [plural(sessions.length, 'session'), `${working} working`];
  if (waiting) parts.push(`${waiting} waiting on you`);
  parts.push(`${plural(agents, 'intern')} active`);
  return parts.join(' · ');
}

// what most needs attention goes first, where it shows in a task bar
export function windowTitle(sessions: readonly Session[]): string {
  const working = sessions.filter((s) => s.status === 'busy').length;
  const waiting = sessions.filter((s) => s.status === 'waiting').length;
  return waiting ? `(${waiting} waiting) Agent Office` : working ? `(${working} working) Agent Office` : 'Agent Office';
}

export function statusLine(s: Session, now: number): string {
  let text: string;
  if (s.status === 'busy') text = s.activity ? `working · ${s.activity}` : 'working';
  else if (s.status === 'waiting') text = s.waitingFor ? `waiting on you · ${s.waitingFor}` : 'waiting on you';
  else text = s.statusSince ? `idle for ${ago(s.statusSince, now)}` : 'idle';
  return s.agents.length ? `${text} · ${plural(s.agents.length, 'intern')}` : text;
}

// the people standing around the desk, one to a line
export function staffLines(s: Session): string[] {
  const staff: string[] = [];
  if (s.supervisor) staff.push(s.supervisor.status === 'busy' ? 'supervisor · taking notes' : 'supervisor · doing the rounds');
  for (const a of s.agents) staff.push(a.desc ? `intern · ${a.type}: ${a.desc}` : `intern · ${a.type}`);
  return staff;
}

export function metaLine(s: Session, now: number): string {
  const meta = [s.background ? 'background' : 'terminal'];
  if (s.startedAt) meta.push(`up ${ago(s.startedAt, now)}`);
  if (s.memMb) meta.push(`${s.memMb} MB`);
  if (s.agentsSpawned) meta.push(`${plural(s.agentsSpawned, 'intern')} so far`);
  return meta.join(' · ');
}
