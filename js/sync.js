// Sincronización con OneDrive (Microsoft Graph).
// Diseño a prueba de mala señal:
//  - Todo se guarda primero en el teléfono (IndexedDB) y entra a una cola ("outbox").
//  - Cada captura es un archivo JSON propio en OneDrive: varios residentes pueden
//    subir a la vez sin pisarse. Las fotos van como .jpg aparte.
//  - Cuando hay señal (al abrir la app, al volver la conexión, cada minuto), se sube la
//    cola y se bajan las capturas de los demás.
import * as db from './db.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['User.Read', 'Files.ReadWrite.All'];

let msalApp = null;
let account = null;
let running = null;
const listeners = new Set();
export const state = { configured: false, signedIn: false, needsLogin: false, syncing: false, pending: 0, lastSync: null, error: null, user: null };

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(patch) { Object.assign(state, patch); listeners.forEach(fn => fn(state)); }

// Client ID del registro "REMA Avance" en Microsoft Entra. Es público (no es una contraseña).
const CLIENT_ID = 'c83db146-c363-4306-9b3d-59a5f2d6c7df';
// Carpeta REMA-Reportes compartida. Solo la abren las cuentas invitadas desde OneDrive.
const SHARE_URL = 'https://1drv.ms/f/c/d1d66cb62bcda0bd/AipGFNHJ_bpKizdiX_iA8Rw?e=GZE9BG';

export async function cloudCfg() {
  const c = await db.kvGet('cloud', {});
  return { clientId: c.clientId || CLIENT_ID, shareUrl: c.shareUrl || SHARE_URL };
}

async function refreshPending() { emit({ pending: (await db.all('outbox')).length }); }

export async function init() {
  const cfg = await cloudCfg();
  emit({ lastSync: await db.kvGet('lastSync', null) });
  await refreshPending();
  if (!cfg.clientId || !window.msal) { emit({ configured: false }); return; }
  try {
    msalApp = new window.msal.PublicClientApplication({
      auth: { clientId: cfg.clientId, authority: 'https://login.microsoftonline.com/common', redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' },
    });
    if (msalApp.initialize) await msalApp.initialize();
    const r = await msalApp.handleRedirectPromise().catch(() => null);
    account = r?.account || msalApp.getAllAccounts()[0] || null;
    emit({ configured: true, signedIn: !!account, user: account?.username || null });
  } catch (e) {
    emit({ configured: false, error: 'No se pudo iniciar Microsoft: ' + e.message });
  }
}

export async function login() {
  if (!msalApp) throw new Error('Falta configurar el Client ID en Ajustes.');
  await msalApp.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export async function logout() {
  if (!msalApp || !account) return;
  await db.kvSet('root', null);
  await msalApp.logoutRedirect({ account, postLogoutRedirectUri: location.origin + location.pathname });
}

async function token() {
  try {
    const r = await msalApp.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch (e) {
    if (e?.name === 'InteractionRequiredAuthError' || /interaction_required|login_required|no_tokens/i.test(e?.errorCode || e?.message || '')) {
      emit({ needsLogin: true });
      throw new Error('La sesión de Microsoft venció. Toca "Iniciar sesión" para seguir subiendo (lo capturado sigue guardado).');
    }
    throw e;
  }
}

async function graph(path, opts = {}) {
  const t = await token();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OneDrive respondió ${res.status}`);
  return res;
}

const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

// Carpeta raíz: la carpeta compartida (si hay link) o "REMA-Reportes" en el OneDrive propio.
async function root() {
  const cfg = await cloudCfg();
  const cached = await db.kvGet('root', null);
  if (cached && cached.key === (cfg.shareUrl || 'me')) return cached;
  let item;
  if (cfg.shareUrl) {
    const r = await graph(`/shares/u!${b64url(cfg.shareUrl)}/driveItem`);
    if (!r) throw new Error('No se encontró la carpeta compartida. Revisa el link en Ajustes.');
    item = await r.json();
  } else {
    let r = await graph('/me/drive/root:/REMA-Reportes');
    if (!r) r = await graph('/me/drive/root/children', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'REMA-Reportes', folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    item = await r.json();
  }
  const out = { key: cfg.shareUrl || 'me', driveId: item.parentReference?.driveId || item.remoteItem?.parentReference?.driveId, itemId: item.id };
  await db.kvSet('root', out);
  return out;
}

const pathUrl = (rt, p) => `/drives/${rt.driveId}/items/${rt.itemId}:/${p.split('/').map(encodeURIComponent).join('/')}`;

const limpiar = rec => { const o = { ...rec }; delete o._sync; delete o._remoteMod; return o; };

// Bytes de una foto guardada. Las fotos nuevas se guardan como ArrayBuffer; las antiguas
// como Blob, que en iPhone a veces ya no se puede volver a leer desde IndexedDB.
export async function photoBytes(ph) {
  if (ph?.data) return ph.data;
  if (ph?.blob) return ph.blob.arrayBuffer();
  return null;
}
export function photoBlob(ph) {
  if (ph?.data) return new Blob([ph.data], { type: ph.type || 'image/jpeg' });
  return ph?.blob || null;
}

async function push(rt) {
  const items = (await db.all('outbox')).sort((a, b) => a.ts - b.ts);
  const errores = [];
  for (const it of items) {
    try {
      if (!(await subir(rt, it))) continue;
    } catch (e) {
      if (e instanceof TypeError) throw e; // sin red: se reintenta todo después
      errores.push(e.message);
      continue; // un error no detiene a los demás
    }
    const still = await db.get('outbox', it.id);
    if (still && still.ts === it.ts) await db.del('outbox', it.id);
    await refreshPending();
  }
  if (errores.length) throw new Error([...new Set(errores)].join(' · '));
}

// Sube un elemento de la cola. Devuelve false si debe quedarse en la cola.
async function subir(rt, it) {
  if (it.kind === 'photo') {
    const ph = await db.get('photos', it.refId);
    if (!ph || ph.synced) return true; // ya está en la nube
    let bytes;
    try { bytes = await photoBytes(ph); } catch { bytes = null; }
    if (!bytes) {
      await db.put('photos', { ...ph, danada: true });
      await db.del('outbox', it.id);
      await refreshPending();
      throw new Error('Una foto no se pudo leer en este teléfono; vuelve a agregarla a la captura.');
    }
    await graph(pathUrl(rt, `obras/${it.obraId}/fotos/${ph.id}.jpg`) + ':/content', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
    const cur = await db.get('photos', ph.id);
    await db.put('photos', { ...(cur || ph), synced: true });
  } else if (it.kind === 'record') {
    const rec = await db.get('records', it.refId);
    if (rec) {
      const r = await graph(pathUrl(rt, `obras/${it.obraId}/capturas/${rec.id}.json`) + ':/content', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(limpiar(rec)),
      });
      const meta = await r.json();
      const cur = await db.get('records', rec.id);
      // Si se editó mientras subía, se queda pendiente para la siguiente vuelta.
      if (cur && (cur.modificado || 0) === (rec.modificado || 0)) await db.put('records', { ...cur, _sync: 'ok', _remoteMod: meta.lastModifiedDateTime });
      else return false;
    }
  } else if (it.kind === 'config') {
    const obra = await db.kvGet('obra:' + it.obraId);
    if (obra) await graph(pathUrl(rt, `obras/${it.obraId}/obra.json`) + ':/content', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obra),
    });
  }
  return true;
}

async function pull(rt, obraId) {
  const pendientes = new Set((await db.all('outbox')).map(o => o.id));
  // Datos de la obra: gana la versión más reciente.
  const r = await graph(pathUrl(rt, `obras/${obraId}/obra.json`) + ':/content');
  const local = await db.kvGet('obra:' + obraId);
  if (r) {
    const remota = await r.json();
    if (!pendientes.has('config:' + obraId) && (remota.updatedAt || 0) > (local?.updatedAt || 0)) await db.kvSet('obra:' + obraId, remota);
  } else if (local?.updatedAt) {
    await db.enqueue('config', obraId, obraId);
  }
  // Capturas de todos.
  let next = pathUrl(rt, `obras/${obraId}/capturas`) + ':/children?$top=200';
  let nuevos = 0;
  while (next) {
    const res = await graph(next);
    if (!res) break;
    const page = await res.json();
    for (const f of page.value || []) {
      if (!f.name.endsWith('.json')) continue;
      const id = f.name.slice(0, -5);
      if (pendientes.has('record:' + id)) continue;
      const loc = await db.get('records', id);
      if (loc && loc._remoteMod === f.lastModifiedDateTime) continue;
      const url = f['@microsoft.graph.downloadUrl'];
      const body = url ? await fetch(url).then(x => x.json()) : await (await graph(`/drives/${rt.driveId}/items/${f.id}/content`)).json();
      await db.put('records', { ...body, _sync: 'ok', _remoteMod: f.lastModifiedDateTime });
      nuevos++;
    }
    next = page['@odata.nextLink'] || null;
  }
  return nuevos;
}

// Descarga bajo demanda de fotos tomadas en otros teléfonos.
export async function getPhoto(obraId, id) {
  const ph = await db.get('photos', id);
  if (ph && !ph.danada && (ph.data || ph.blob)) return photoBlob(ph);
  if (!state.signedIn || !navigator.onLine) return null;
  try {
    const rt = await root();
    const r = await graph(pathUrl(rt, `obras/${obraId}/fotos/${id}.jpg`) + ':/content');
    if (!r) return null;
    const data = await r.arrayBuffer();
    await db.put('photos', { id, obraId, data, type: 'image/jpeg', synced: true });
    return new Blob([data], { type: 'image/jpeg' });
  } catch { return null; }
}

export async function syncNow(obraId) {
  await refreshPending();
  if (running) return running;
  if (!state.configured || !state.signedIn || !navigator.onLine) return 0;
  running = (async () => {
    emit({ syncing: true, error: null });
    try {
      const rt = await root();
      await push(rt);
      const nuevos = await pull(rt, obraId);
      await push(rt); // por si pull encoló la configuración
      const now = Date.now();
      await db.kvSet('lastSync', now);
      emit({ lastSync: now, needsLogin: false });
      return nuevos;
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError;
      emit({ error: offline ? null : e.message });
      return 0;
    } finally {
      running = null;
      emit({ syncing: false });
      await refreshPending();
    }
  })();
  return running;
}

export async function markChanged() { await refreshPending(); }
