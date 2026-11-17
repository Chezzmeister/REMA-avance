// Conexión con el intermediario REMA (Cloudflare) y sincronización sin señal.
//  - Todo se guarda primero en el teléfono (IndexedDB) y entra a una cola ("outbox").
//  - Cuando hay señal (al abrir, al volver la conexión, cada minuto) se sube la cola y
//    se bajan las capturas que este usuario tiene permitido ver.
//  - Los permisos los decide el intermediario; la app solo esconde lo que no aplica.
import * as db from './db.js';

const API_PROD = 'https://rema-api.REEMPLAZAR.workers.dev/api';
export const API = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787/api' : API_PROD;

let running = null;
const listeners = new Set();
export const state = { sesion: null, needsLogin: false, syncing: false, pending: 0, lastSync: null, error: null };

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(patch) { Object.assign(state, patch); listeners.forEach(fn => fn(state)); }

export const rol = () => state.sesion?.usuario?.rol || null;
export const gestiona = () => ['admin', 'gerente'].includes(rol());

class ApiError extends Error { constructor(status, msg, data) { super(msg); this.status = status; this.data = data; } }

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.sesion?.token) headers.Authorization = 'Bearer ' + state.sesion.token;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body });
  if (res.status === 401 && path !== '/login') {
    emit({ needsLogin: true });
    throw new ApiError(401, 'La sesión venció. Vuelve a iniciar sesión; lo capturado sigue guardado.');
  }
  const tipo = res.headers.get('Content-Type') || '';
  const data = tipo.includes('application/json') ? await res.json() : res;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Error ${res.status}`, data);
  return data;
}

async function refreshPending() { emit({ pending: (await db.all('outbox')).length }); }

export async function init() {
  // Migración desde la versión con cuenta Microsoft: se descartan colas que ya no aplican.
  if ((await db.kvGet('esquema', 1)) < 2) {
    for (const it of await db.all('outbox')) if (it.kind === 'config') await db.del('outbox', it.id);
    for (const k of ['cloud', 'root']) await db.del('kv', k);
    await db.kvSet('esquema', 2);
  }
  emit({ sesion: await db.kvGet('sesion', null), lastSync: await db.kvGet('lastSync', null) });
  await refreshPending();
}

export async function login(usuario, password) {
  const r = await api('/login', { method: 'POST', json: { usuario, password } });
  const anterior = await db.kvGet('sesion', null);
  // Si entra otra persona en este teléfono, se limpian los datos de la anterior.
  if (anterior && anterior.usuario.id !== r.usuario.id) await borrarDatosLocales();
  const sesion = { token: r.token, usuario: r.usuario, obras: r.obras };
  await db.kvSet('sesion', sesion);
  emit({ sesion, needsLogin: false, error: null });
  return sesion;
}

export async function logout() {
  try { if (navigator.onLine) await api('/logout', { method: 'POST' }); } catch { /* sin señal: se cierra igual */ }
  await borrarDatosLocales();
  await db.del('kv', 'sesion');
  emit({ sesion: null, needsLogin: false, pending: 0 });
}

async function borrarDatosLocales() {
  for (const s of ['records', 'photos', 'outbox']) await db.clear(s);
  for (const k of await db.keys('kv')) if (k !== 'esquema') await db.del('kv', k);
}

// ---------- Fotos ----------
export async function photoBytes(ph) {
  if (ph?.data) return ph.data;
  if (ph?.blob) return ph.blob.arrayBuffer();
  return null;
}
export function photoBlob(ph) {
  if (ph?.data) return new Blob([ph.data], { type: ph.type || 'image/jpeg' });
  return ph?.blob || null;
}

export async function getPhoto(obraId, id) {
  const ph = await db.get('photos', id);
  if (ph && !ph.danada && (ph.data || ph.blob)) return photoBlob(ph);
  if (!state.sesion || !navigator.onLine) return null;
  try {
    const res = await api(`/obras/${obraId}/fotos/${id}`);
    const data = await res.arrayBuffer();
    await db.put('photos', { id, obraId, data, type: 'image/jpeg', synced: true });
    return new Blob([data], { type: 'image/jpeg' });
  } catch { return null; }
}

// ---------- Subida ----------
async function subir(it) {
  if (it.kind === 'photo') {
    const ph = await db.get('photos', it.refId);
    if (!ph || ph.synced) return true;
    let bytes;
    try { bytes = await photoBytes(ph); } catch { bytes = null; }
    if (!bytes) {
      await db.put('photos', { ...ph, danada: true });
      throw new ApiError(400, 'Una foto no se pudo leer en este teléfono; vuelve a agregarla a la captura.');
    }
    await api(`/obras/${it.obraId}/fotos/${ph.id}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
    const cur = await db.get('photos', ph.id);
    await db.put('photos', { ...(cur || ph), synced: true });
  } else if (it.kind === 'fotodel') {
    await api(`/obras/${it.obraId}/fotos/${it.refId}`, { method: 'DELETE' });
    await db.del('photos', it.refId);
  } else if (it.kind === 'record') {
    const rec = await db.get('records', it.refId);
    if (!rec) return true;
    // Las fotos de la captura se suben antes que la captura.
    for (const f of rec.fotos || []) {
      const ph = await db.get('photos', f.id);
      if (ph && !ph.synced && !ph.danada) await subir({ kind: 'photo', refId: f.id, obraId: it.obraId });
    }
    let r;
    try {
      r = await api(`/obras/${it.obraId}/capturas/${rec.id}`, { method: 'PUT', json: rec });
    } catch (e) {
      if (e.status === 409 && e.data?.captura) {
        await db.put('records', { ...e.data.captura, _sync: 'ok', _subido: true });
        throw new ApiError(409, 'Una captura ya subida no se puede modificar; se restauró la versión guardada.');
      }
      throw e;
    }
    const cur = await db.get('records', rec.id);
    // Si se editó mientras subía, se queda en la cola para la siguiente vuelta.
    if (cur && (cur.modificado || 0) !== (rec.modificado || 0)) return false;
    await db.put('records', { ...rec, ...r.captura, modificado: rec.modificado, _sync: 'ok', _subido: true });
  }
  return true;
}

async function push() {
  const items = (await db.all('outbox')).sort((a, b) => a.ts - b.ts);
  const errores = [];
  for (const it of items) {
    try {
      if (!(await subir(it))) continue;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;        // sin red: se reintenta todo después
      if (e.status === 401) throw e;
      errores.push(e.message);
      // 503: OneDrive no conectado → se queda en la cola. 4xx: no tiene arreglo → se quita.
      if (e.status >= 500) continue;
    }
    const still = await db.get('outbox', it.id);
    if (still && still.ts === it.ts) await db.del('outbox', it.id);
    await refreshPending();
  }
  if (errores.length) throw new ApiError(0, [...new Set(errores)].join(' · '));
}

// ---------- Bajada ----------
async function pull(obraId) {
  const me = await api('/me');
  const sesion = { ...state.sesion, usuario: me.usuario, obras: me.obras };
  await db.kvSet('sesion', sesion);
  emit({ sesion });
  if (!obraId || !me.obras.some(o => o.id === obraId)) return 0;
  const obra = await api(`/obras/${obraId}`);
  await db.kvSet('obra:' + obraId, obra);
  const pendientes = new Set((await db.all('outbox')).map(o => o.id));
  const desde = await db.kvGet('cursor:' + obraId, 0);
  const r = await api(`/obras/${obraId}/capturas?desde=${desde}`);
  for (const c of r.capturas) {
    if (pendientes.has('record:' + c.id)) continue;
    await db.put('records', { ...c, _sync: 'ok', _subido: true });
  }
  await db.kvSet('cursor:' + obraId, r.hasta);
  return r.capturas.length;
}

export async function syncNow(obraId) {
  await refreshPending();
  if (running) return running;
  if (!state.sesion || state.needsLogin || !navigator.onLine) return 0;
  running = (async () => {
    emit({ syncing: true, error: null });
    try {
      let err = null;
      try { await push(); } catch (e) { if (!(e instanceof ApiError) || e.status === 401) throw e; err = e.message; }
      const n = await pull(obraId);
      const t = Date.now();
      await db.kvSet('lastSync', t);
      emit({ lastSync: t, error: err });
      return n;
    } catch (e) {
      emit({ error: e instanceof ApiError ? e.message : null }); // TypeError = sin red
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
