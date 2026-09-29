/**
 * Stands in for `@/lib/auth/session` under node --test (see ../story-hooks.mjs).
 * The story sets `globalThis.__STORY_SESSION__`; with none set, every call
 * behaves as signed out.
 */
export type BusinessRole = "owner" | "admin" | "member" | "viewer";
export type ActiveWorkspace = {
  userId: string;
  businessId: string;
  role: BusinessRole;
  businessName: string;
  businessStatus: string;
  onboardingStep: string;
  activatedAt: string | null;
  timezone: string;
};

const RANK: Record<BusinessRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

function current(): ActiveWorkspace | null {
  return (globalThis as { __STORY_SESSION__?: ActiveWorkspace }).__STORY_SESSION__ ?? null;
}

class StoryRedirect extends Error {}

export async function getUser() {
  const session = current();
  return session ? { id: session.userId, email: `story-${session.userId}@example.invalid` } : null;
}
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new StoryRedirect("redirect:/login");
  return user;
}
export async function readActiveWorkspace() {
  return current();
}
export const getActiveWorkspace = readActiveWorkspace;
export async function requireWorkspace() {
  const session = current();
  if (!session) throw new StoryRedirect("redirect:/login");
  return session;
}
export function hasRole(role: BusinessRole, minimum: BusinessRole) {
  return RANK[role] >= RANK[minimum];
}
export async function requireRole(minimum: BusinessRole) {
  const session = await requireWorkspace();
  if (!hasRole(session.role, minimum)) throw new StoryRedirect("redirect:/app");
  return session;
}
export async function isPlatformAdmin() {
  return false;
}
// Stories run without two-factor or idle policy: the secure read is the plain read.
export const getSecureWorkspace = readActiveWorkspace;
