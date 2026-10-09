import { z } from 'zod';

// The state the Rust side sends. Mirrored by the structs in
// `src-tauri/src/state.rs` field for field: change both together.

export const AgentSchema = z.object({
  id: z.string(),
  type: z.string(),
  desc: z.string(),
  startedAt: z.number(),
});

export const SupervisorSchema = z.object({
  status: z.enum(['busy', 'idle']),
});

export const SessionSchema = z.object({
  id: z.string(),
  pid: z.number(),
  name: z.string(), // the repo the session works in
  cwd: z.string(),
  background: z.boolean(), // headless, started through the SDK
  status: z.enum(['busy', 'waiting', 'idle']),
  waitingFor: z.string().nullable(),
  activity: z.string().nullable(), // a tool's name, 'writing' or 'thinking', while busy
  startedAt: z.number().nullable(),
  statusSince: z.number().nullable(),
  memMb: z.number().nullable(),
  agents: z.array(AgentSchema), // the subagents still working, oldest first
  agentsSpawned: z.number(),
  supervisor: SupervisorSchema.nullable(),
});

export const OfficeStateSchema = z.object({
  home: z.string(),
  sessions: z.array(SessionSchema),
});

export type Agent = z.infer<typeof AgentSchema>;
export type Supervisor = z.infer<typeof SupervisorSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type OfficeState = z.infer<typeof OfficeStateSchema>;
