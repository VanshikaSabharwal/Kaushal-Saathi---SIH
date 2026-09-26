/**
 * Work for a person to do: call someone back, enrol them, follow them up.
 *
 * This is the "Needs attention" queue. Anything the bot cannot finish — a
 * hand-off, an interested beneficiary who needs enrolling — becomes a task
 * with an owner and a due date, so it is never only a line in a log.
 */

import { randomUUID } from "node:crypto";
import { createCollection } from "./collection";

export type Actor = "bot" | "beneficiary" | "saathi" | "officer" | "centre" | "consultant";

export type TaskType = "callback" | "enrol" | "follow_up" | "ticket" | "verify" | "consult";
export type TaskStatus = "open" | "done" | "cancelled";

export type Task = {
  id: string;
  type: TaskType;
  beneficiaryId: string;
  district?: string;
  block?: string;
  reason: string;
  /**
   * Distinguishes tasks of one type that may be open together — the 30- and
   * 90-day follow-ups, or two separate complaints. Without a key, one open
   * task per type and person.
   */
  key?: string;
  owner: Actor;
  status: TaskStatus;
  createdAt: number;
  dueAt: number;
  doneAt?: number;
  data?: Record<string, unknown>;
};

const HOUR = 60 * 60 * 1000;

/** How soon each kind of task should be picked up. */
const DUE_IN: Record<TaskType, number> = {
  callback: 24 * HOUR,
  enrol: 72 * HOUR,
  follow_up: 24 * HOUR,
  ticket: 48 * HOUR,
  verify: 72 * HOUR,
  consult: 72 * HOUR,
};

const OWNER: Record<TaskType, Actor> = {
  callback: "saathi",
  enrol: "centre",
  follow_up: "saathi",
  ticket: "officer",
  verify: "officer",
  consult: "consultant",
};

export const tasks = createCollection<Task>("tasks");

/**
 * Open a task unless an identical one is already open.
 *
 * A caller who asks for a person twice in one call, or calls back before
 * anyone rang them, should still be one entry in the queue, not three.
 */
export async function openTask(input: {
  type: TaskType;
  beneficiaryId: string;
  reason: string;
  key?: string;
  id?: string;
  district?: string;
  block?: string;
  data?: Record<string, unknown>;
  dueAt?: number;
}): Promise<Task> {
  const open = await tasks.list({
    type: input.type,
    beneficiaryId: input.beneficiaryId,
    status: "open",
  });
  const existing = open.find((t) => t.key === input.key);
  if (existing) return existing;

  const now = Date.now();
  const task: Task = {
    owner: OWNER[input.type],
    status: "open",
    createdAt: now,
    dueAt: input.dueAt ?? now + DUE_IN[input.type],
    ...input,
    id: input.id ?? randomUUID(),
  };

  await tasks.upsert(task);
  return task;
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<Task | null> {
  return tasks.update(id, (t) =>
    t ? { ...t, status, doneAt: status === "open" ? undefined : Date.now() } : null,
  );
}
