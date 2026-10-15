import { newId, nowIso, orgPath, requireOrg, notFound, type Deps, type RequestContext } from './core';

export interface Notification {
  id: string;
  uid: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

/** In-app notification channel (the enabled channel for the MVP). */
export async function notify(deps: Deps, orgId: string, uid: string, body: string, title: string, link: string) {
  const n: Notification = { id: newId('ntf'), uid, title: title.slice(0, 200), body: body.slice(0, 1000), link, read: false, createdAt: nowIso(deps) };
  await deps.store.set(orgPath(orgId, 'notifications', n.id), n);
  return n;
}

export async function listNotifications(deps: Deps, ctx: RequestContext) {
  const orgId = requireOrg(ctx);
  const list = await deps.store.list<Notification>(orgPath(orgId, 'notifications'), [['uid', '==', ctx.uid]]);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

export async function markNotificationRead(deps: Deps, ctx: RequestContext, id: string) {
  const orgId = requireOrg(ctx);
  const n = await deps.store.get<Notification>(orgPath(orgId, 'notifications', id));
  if (!n || n.uid !== ctx.uid) throw notFound('Notification');
  await deps.store.update(orgPath(orgId, 'notifications', id), { read: true });
  return { ok: true };
}
