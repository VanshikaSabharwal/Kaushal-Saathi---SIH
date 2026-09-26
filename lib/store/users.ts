/**
 * Staff accounts. Each has one role and the scope that role works in — a
 * district officer their district, a state corporation its state, a centre its
 * own centre — and every read and write is filtered through that scope (see
 * scope.ts).
 */

import { randomUUID } from "node:crypto";
import { checkPassword, hashPassword } from "../auth/password";
import type { Role } from "../auth/session";
import { createCollection } from "./collection";

export type User = {
  id: string;
  username: string;
  name: string;
  role: Role;
  state?: string;
  district?: string;
  centreId?: string;
  consultantId?: string;
  salt: string;
  hash: string;
  createdAt: number;
};

export type PublicUser = Omit<User, "salt" | "hash">;

export const users = createCollection<User>("users");

export function toPublic(u: User): PublicUser {
  const rest: Partial<User> = { ...u };
  delete rest.salt;
  delete rest.hash;
  return rest as PublicUser;
}

export async function createUser(
  input: Omit<User, "id" | "salt" | "hash" | "createdAt"> & { password: string },
): Promise<PublicUser> {
  const { password, ...rest } = input;
  const fields = { ...rest, username: rest.username.trim().toLowerCase() };
  const existing = await users.findOne({ username: fields.username });
  const { salt, hash } = hashPassword(password);

  const user: User = {
    ...fields,
    id: existing?.id ?? randomUUID(),
    salt,
    hash,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  await users.upsert(user);
  return toPublic(user);
}

export async function login(username: string, password: string): Promise<PublicUser | null> {
  const user = await users.findOne({ username: username.trim().toLowerCase() });
  if (!user) return null;
  return checkPassword(password, user.salt, user.hash) ? toPublic(user) : null;
}
