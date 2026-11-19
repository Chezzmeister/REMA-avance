import * as db from './db.js';
import * as sync from './sync.js';
import * as C from './calc.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => (v === '' || v === null || v === undefined ? undefined : +String(v).replace(/[$,\s]/g, ''));

let obra = null, records = [], settings = { obraId: null }, corte = C.hoy();
const main = () => $('#main');
const ses = () => sync.state.sesion;
const rol = () => sync.rol();
const gestor = () => sync.gestiona();
const ROL_NOMBRE = { admin: 'Administrador', gerente: 'Gerente', supervisor: 'Supervisor' };

// Menú por rol. "Cuenta" vive en el encabezado (nombre del usuario).
const MENUS = {
  supervisor: [['capturar', 'Capturar'], ['historial', 'Mis capturas'], ['fotos', 'Fotos'], ['obra', 'Obra']],
  gerente: [['tablero', 'Tablero'], ['capturar', 'Capturar'], ['historial', 'Capturas'], ['fotos', 'Fotos'], ['obra', 'Obra']],
  admin: [['tablero', 'Tablero'], ['capturar', 'Capturar'], ['historial', 'Capturas'], ['fotos', 'Fotos'], ['obra', 'Obra'], ['admin', 'Admin']],
};
const inicio = () => (gestor() ? 'tablero' : 'capturar');

// ---------- Datos ----------
async function cargar() {
  settings = await db.kvGet('settings', { obraId: null });
  const obras = ses()?.obras || [];
  if (!obras.some(o => o.id === settings.obraId)) {
    settings.obraId = obras.length === 1 ? obras[0].id : null;
    await db.kvSet('settings', settings);
  }
  obra = settings.obraId ? await db.kvGet('obra:' + settings.obraId, null) : null;
  records = obra ? (await db.all('records')).filter(r => r.obraId === obra.id) : [];
}

const editable = rec => gestor() || !rec._subido;

async function guardarRecord(rec) {
  rec.modificado = Date.now();
  rec._sync = 'pendiente';
  await db.put('records', rec);
  await db.enqueue('record', rec.id, rec.obraId);
  for (const f of rec.fotos || []) {
    const ph = await db.get('photos', f.id);
    if (ph && !ph.synced) await db.enqueue('photo', f.id, rec.obraId);
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  await cargar();
  pedirSync();
}

let syncTimer;
function pedirSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const antes = JSON.stringify(ses()?.obras || []);
    const faltabaObra = !obra;
    const n = await sync.syncNow(settings.obraId);
    const ruta = rutaActual()[0];
    const cambio = n || antes !== JSON.stringify(ses()?.obras || []);
    // No se repinta una pantalla con un formulario a medio llenar (salvo que estuviera esperando la obra).
    if (faltabaObra || (cambio && !['capturar', 'admin', 'cuenta'].includes(ruta))) {
      await cargar();
      if (faltabaObra ? !!obra : true) render();
    }
  }, 400);
}

// ---------- Encabezado y estado ----------
function pintarEstado(s = sync.state) {
  const el = $('#estado');
  if (!s.sesion) { el.className = 'estado'; el.textContent = ''; return; }
  let txt, cls;
  if (s.needsLogin) { txt = `Sesión vencida · toca para entrar${s.pending ? ` (${s.pending} por subir)` : ''}`; cls = 'warn'; }
  else if (!navigator.onLine) { txt = `Sin señal · ${s.pending ? s.pending + ' por subir' : 'todo guardado en el teléfono'}`; cls = 'off'; }
  else if (s.syncing) { txt = 'Sincronizando…'; cls = 'busy'; }
  else if (s.error) { txt = s.error; cls = 'err'; }
  else if (s.pending) { txt = `${s.pending} por subir`; cls = 'busy'; }
  else { txt = s.lastSync ? `Sincronizado · ${new Date(s.lastSync).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Listo'; cls = 'ok'; }
  el.className = 'estado ' + cls;
  el.textContent = txt;
  el.onclick = s.needsLogin ? () => { location.hash = '#/cuenta'; } : null;
}

function pintarEncabezado() {
  const s = ses();
  $('#quien').textContent = s ? s.usuario.nombre : '';
  $('#quien').hidden = !s;
  const o = s?.obras.find(x => x.id === settings.obraId);
  $('#obraActual').textContent = o ? o.nombre : '';
  const nav = $('nav');
  nav.hidden = !s;
  if (s) nav.innerHTML = MENUS[rol()].map(([r, t]) => `<a href="#/${r}">${t}</a>`).join('');
}

// ---------- Rutas ----------
function rutaActual() {
  const [camino, query] = location.hash.replace(/^#\/?/, '').split('?');
  const partes = camino.split('/').filter(Boolean);
  return [partes[0] || '', partes[1], partes[2], new URLSearchParams(query || '')];
}

const VISTAS = { tablero: vTablero, capturar: vCapturar, historial: vHistorial, fotos: vFotos, obra: vObra, cuenta: vCuenta, admin: vAdmin, ver: vDetalle };

async function render() {
  pintarEncabezado();
  pintarEstado();
  if (!ses()) return vLogin();
  let [ruta, a1, a2, q] = rutaActual();
  const permitidas = [...MENUS[rol()].map(m => m[0]), 'cuenta', 'ver'];
  if (!permitidas.includes(ruta)) { location.replace('#/' + inicio()); return; }
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('activo', a.getAttribute('href') === '#/' + (ruta === 'ver' ? 'historial' : ruta)));
  const sinObra = !['obra', 'cuenta', 'admin'].includes(ruta);
  if (sinObra && !settings.obraId) return vObra();
  if (sinObra && !obra) {
    main().innerHTML = `<h1>Descargando la obra…</h1><p class="peq">${navigator.onLine ? 'Un momento.' : 'Necesitas señal la primera vez que abres una obra en este teléfono.'}</p>`;
    pedirSync();
    return;
  }
  return VISTAS[ruta](a1, a2, q);
}

// ---------- Login ----------
function vLogin(expirada = false) {
  main().innerHTML = `
  <div class="login">
    <h1>${expirada ? 'Vuelve a iniciar sesión' : 'Iniciar sesión'}</h1>
    ${expirada ? '<p class="peq">Lo que capturaste sigue guardado en este teléfono y se subirá al entrar.</p>' : ''}
    <form id="fl" class="form">
      <label>Usuario<input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(expirada ? ses()?.usuario.usuario : '')}"></label>
      <label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label>
      <p id="errLogin" class="neg"></p>
      <button class="btn grande">Entrar</button>
    </form>
    <p class="peq">Necesitas señal para entrar. Después la app funciona sin señal.</p>
  </div>`;
  // Primera vez: si el servidor no tiene usuarios, se ofrece crear el administrador.
  if (!expirada && navigator.onLine) sync.api('/setup').then(r => { if (r.necesario) vCrearAdmin(); }).catch(() => {});
  $('#fl').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), btn = e.target.querySelector('button');
    if (!navigator.onLine) { $('#errLogin').textContent = 'No hay señal. Intenta cuando tengas conexión.'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await sync.login(fd.get('usuario').trim(), fd.get('password'));
      await cargar();
      location.hash = '#/' + inicio();
      render();
      pedirSync();
    } catch (err) {
      $('#errLogin').textContent = err instanceof TypeError ? 'No se pudo conectar. Revisa tu señal.' : err.message;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
}

function vCrearAdmin() {
  main().innerHTML = `
  <div class="login">
    <h1>Crear administrador</h1>
    <p class="peq">Es la primera vez que se usa el sistema. Crea tu cuenta de administrador; con ella darás de alta a los demás.</p>
    <form id="fa" class="form">
      <label>Nombre completo<input name="nombre" required></label>
      <label>Usuario<input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required pattern="[a-zA-Z0-9._\\-]{3,40}"></label>
      <label>Contraseña <span class="peq">mínimo 8 caracteres</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <label>Repite la contraseña<input type="password" name="password2" autocomplete="new-password" minlength="8" required></label>
      <p id="errA" class="neg"></p>
      <button class="btn grande">Crear y entrar</button>
    </form>
  </div>`;
  $('#fa').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('password') !== fd.get('password2')) { $('#errA').textContent = 'Las contraseñas no coinciden.'; return; }
    try {
      await sync.api('/setup', { method: 'POST', json: { nombre: fd.get('nombre').trim(), usuario: fd.get('usuario').trim(), password: fd.get('password') } });
      await sync.login(fd.get('usuario').trim(), fd.get('password'));
      await cargar();
      location.hash = '#/admin/onedrive';
      render();
    } catch (err) { $('#errA').textContent = err.message; }
  };
}

// ---------- Obra (selector) ----------
function vObra() {
  const obras = ses().obras;
  main().innerHTML = `<h1>Obra</h1>
  ${obras.length ? `<p class="peq">Elige la obra en la que vas a trabajar.</p>
  <div class="lista-obras">${obras.map(o => `<button class="obra-op ${o.id === settings.obraId ? 'sel' : ''}" data-id="${esc(o.id)}">${esc(o.nombre)}${o.id === settings.obraId ? '<span class="chip ok">Actual</span>' : ''}</button>`).join('')}</div>`
    : '<p>No tienes obras asignadas. Pide al administrador que te asigne una.</p>'}
  ${obra && gestor() ? `<div class="tarjeta"><h3>${esc(obra.nombre)}</h3><p class="peq">${esc(obra.localidad)}<br>${esc(obra.cliente || '')}${obra.concurso ? ' · Concurso ' + esc(obra.concurso) : ''}<br>Del ${C.fechaCorta(obra.inicio)} al ${C.fechaCorta(obra.fin)}</p>${rol() === 'admin' ? `<a class="btn sec" href="#/admin/obra/${esc(obra.id)}">Editar datos de la obra</a>` : ''}</div>` : ''}`;
  main().querySelectorAll('.obra-op').forEach(b => b.onclick = async () => {
    settings.obraId = b.dataset.id;
    await db.kvSet('settings', settings);
    await cargar();
    location.hash = '#/' + inicio();
    render();
    pedirSync();
  });
}

// ---------- Tablero (gerente y administrador) ----------
function barra(pct, color = 'var(--verde)') {
  const p = Math.max(0, Math.min(1, pct || 0)) * 100;
  return `<div class="barra"><span style="width:${p}%;background:${color}"></span></div>`;
}
function kpi(t, v, a, b, pct) {
  return `<div class="kpi"><div class="kpi-t">${t}</div><div class="kpi-v">${v}</div>${pct !== undefined ? barra(pct) : ''}<div class="kpi-a">${a || ''}</div><div class="kpi-b">${b || ''}</div></div>`;
}

// Ubicación de la partida desde el nivel de agrupación (p. ej. "EXCAVACIÓN TIPO III › RED DE ATARJEAS").
const rutaCorta = k => (k.ruta || []).slice(Math.max(0, Math.min((obra?.nivelGrupo || 1) - 1, (k.ruta || []).length - 1))).join(' › ');

// Nombre corto de una partida: etiqueta del administrador, o su grupo más específico, o la clave.
const etiquetaPartida = k => obra.etiquetas?.[k.id] || (k.ruta?.length ? k.ruta[k.ruta.length - 1] : '') || k.clave;

function vTablero() {
  const R = C.resumen(obra, records, corte);
  const est = R.programa.metodo === 'mensual' ? ' (est.)' : '';
  const modoP = R.modo === 'partidas';
  const t = R.tuberia?.total;
  const dev = R.desviacion;
  const filaPartida = k => `<tr><td><b>${esc(k.clave)}</b><div class="peq">${esc(k.descripcion.slice(0, 90))}${k.descripcion.length > 90 ? '…' : ''}</div></td>
    <td class="r">${C.fmtCant(k.ejecutado)} / ${C.fmtCant(k.cantidad, k.unidad)}</td>
    <td class="r ${k.pct + 0.0001 < k.pctProg ? 'neg' : ''}">${C.fmtPct(k.pct)}<div class="peq">prog. ${C.fmtPct(k.pctProg)}</div></td></tr>`;
  main().innerHTML = `
  <section class="cab">
    <h1>${esc(obra.nombre)}</h1>
    <p class="sub">${esc(obra.localidad)}</p>
    <label class="corte">Avance al <input type="date" id="corte" value="${corte}"></label>
  </section>
  <div class="kpis">
    ${kpi('Plazo transcurrido', C.fmtPct(R.plazo.pct), `Día ${R.plazo.dia} de ${R.plazo.duracion}`, `${R.plazo.restantes} días restantes`, R.plazo.pct)}
    ${modoP ? '' : kpi('Tubería instalada', C.fmtPct(t.pct), `${C.fmtM(t.instalado)} de ${C.fmtM(t.longitud)}`, R.tuberia.tramos.map(x => x.diametro).join(' y '), t.pct)}
    ${kpi('Programa a la fecha' + est, C.fmtPct(R.programa.pct), `${C.fmtMoney(R.programa.importe)} de ${C.fmtMoney(R.programa.total)}`, 'Importe programado acumulado', R.programa.pct)}
    ${kpi('Avance físico real', C.fmtPct(R.fisico), dev === null ? (modoP ? 'Sin cantidades capturadas' : 'Captura el avance por grupo') : `<b class="${dev < 0 ? 'neg' : 'pos'}">${dev >= 0 ? '+' : ''}${(dev * 100).toFixed(1)} pts</b> vs programa`, modoP ? 'Cantidades ejecutadas × precio unitario' : 'Ponderado por importe', R.fisico ?? undefined)}
    ${kpi('Avance financiero real', C.fmtPct(R.financiero?.pct), R.financiero ? C.fmtMoney(R.financiero.importe) : 'Sin captura', R.financiero ? 'Al ' + C.fechaCorta(R.financiero.fecha) : '', R.financiero?.pct)}
    ${kpi('Personal en obra', R.personal ? esc(R.personal.valor) : '—', R.personal ? 'Al ' + C.fechaCorta(R.personal.fecha) : 'Sin captura')}
    ${kpi('Atrasos', R.atrasos ? esc(R.atrasos.valor) + ' días' : '—', R.atrasos ? 'Al ' + C.fechaCorta(R.atrasos.fecha) : 'Sin captura')}
  </div>
  ${R.programa.metodo === 'mensual' ? `<p class="nota">Programa estimado con los montos mensuales.${rol() === 'admin' ? ` Importa el programa de obra (AE10) en <a href="#/admin/obra/${esc(obra.id)}">los datos de la obra</a> para el cálculo exacto por partida.` : ''}</p>` : ''}

  ${modoP ? (R.destacados.length ? `<h2>Partidas destacadas</h2>
  <div class="tarjeta">
  ${R.destacados.map(k => `
    <div class="tramo">
      <div class="fila"><b>${esc(etiquetaPartida(k))}</b><span class="pct">${C.fmtPct(k.pct)}</span></div>
      ${barra(k.pct)}
      <div class="peq">${C.fmtCant(k.ejecutado, k.unidad)} de ${C.fmtCant(k.cantidad, k.unidad)} · faltan ${C.fmtCant(k.restante, k.unidad)} · programado a la fecha ${C.fmtPct(k.pctProg)} ${k.excede ? '<b class="neg">· excede la cantidad del catálogo</b>' : ''}</div>
    </div>`).join('')}
  </div>` : (rol() === 'admin' ? `<p class="nota">Elige las partidas destacadas (por ejemplo, la tubería o los pozos) en <a href="#/admin/obra/${esc(obra.id)}">los datos de la obra</a>.</p>` : '')) : `
  <h2>Tubería</h2>
  <div class="tarjeta">
  ${R.tuberia.tramos.map(tr => `
    <div class="tramo">
      <div class="fila"><b>${esc(tr.frente)} · ${esc(tr.diametro)}</b><span class="pct">${C.fmtPct(tr.pct)}</span></div>
      ${barra(tr.pct)}
      <div class="peq">${C.fmtM(tr.instalado)} de ${C.fmtM(tr.longitud)} · por instalar ${C.fmtM(tr.restante)} ${tr.excede ? '<b class="neg">· excede la longitud total</b>' : ''}</div>
    </div>`).join('') || '<p class="peq">Sin tramos.</p>'}
  ${R.tuberia.frentes.map(f => `<div class="fila total"><b>Total ${esc(f.frente)}</b><span>${C.fmtM(f.instalado)} de ${C.fmtM(f.longitud)} · ${C.fmtPct(f.pct)}</span></div>`).join('')}
  </div>`}

  <h2>Programa de erogaciones</h2>
  <div class="tarjeta"><table><thead><tr><th>Periodo</th><th class="r">Importe</th><th class="r">% periodo</th><th class="r">% acum.</th></tr></thead><tbody>
  ${R.periodos.map(p => `<tr><td>${p.nombre}</td><td class="r">${C.fmtMoney(p.monto)}</td><td class="r">${C.fmtPct(p.pct)}</td><td class="r">${C.fmtPct(p.pctAcum)}</td></tr>`).join('')}
  </tbody></table></div>

  <h2>Avance por grupo</h2>
  ${modoP ? `<div class="tarjeta grupos">
    ${R.grupos.filas.map(g => `<details class="grupo">
      <summary><div class="fila"><b>${esc(g.nombre)}</b><span class="pct">${C.fmtPct(g.avance)}</span></div>
        ${barra(g.avance)}
        <div class="peq">${C.fmtMoney(g.importe)} · ${C.fmtPct(g.peso)} del total · ${g.partidas.length} ${g.partidas.length === 1 ? 'partida' : 'partidas'}</div></summary>
      <table><tbody>${g.partidas.map(filaPartida).join('')}</tbody></table>
    </details>`).join('')}
    <div class="fila total"><b>Total</b><span>${C.fmtMoney(R.grupos.total)} · avance ${C.fmtPct(R.fisico)}</span></div>
  </div>` : `<div class="tarjeta"><table><thead><tr><th>Grupo</th><th class="r">Importe</th><th class="r">%</th><th class="r">Real</th></tr></thead><tbody>
  ${R.grupos.filas.map(g => `<tr><td>${esc(g.nombre)}</td><td class="r">${C.fmtMoney(g.importe)}</td><td class="r">${C.fmtPct(g.peso)}</td><td class="r">${C.fmtPct(g.avance)}</td></tr>`).join('')}
  <tr class="tot"><td>Total</td><td class="r">${C.fmtMoney(R.grupos.total)}</td><td class="r">100.0%</td><td class="r">${C.fmtPct(R.fisico)}</td></tr>
  </tbody></table></div>`}

  <h2>Semana del ${C.fechaCorta(R.desde)} al ${C.fechaCorta(R.corte)}</h2>
  ${[['Actividades de la próxima semana', R.actividades], ['Atrasos y problemática', R.problematica], ['Requerimientos y acuerdos', R.requerimientos]].map(([tit, it]) => `
    <div class="tarjeta"><h3>${tit}</h3>${it.length ? '<ul>' + it.map(i => `<li>${esc(i.texto)} <span class="peq">— ${esc(i.autor || '')} ${C.fechaCorta(i.fecha)}</span></li>`).join('') + '</ul>' : '<p class="peq">Sin registros.</p>'}</div>`).join('')}
  <p class="peq">${R.fotos.length} fotografías en la semana.</p>

  <button class="btn grande" id="pptx">Descargar reporte PPTX</button>
  <a class="btn grande sec" href="#/capturar">+ Nueva captura</a>`;
  $('#corte').onchange = e => { corte = e.target.value || C.hoy(); render(); };
  $('#pptx').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Generando…';
    try {
      const { generarPPTX } = await import('./pptx.js');
      await generarPPTX(obra, R, id => sync.getPhoto(obra.id, id), etiquetaPartida);
    } catch (err) { alert(err.message); }
    e.target.disabled = false; e.target.textContent = 'Descargar reporte PPTX';
  };
}

// ---------- Captura ----------
async function comprimir(file, max = 1600, q = 0.72) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(r => cv.toBlob(b => r(b || file), 'image/jpeg', q));
}

async function miniaturas(fotos, urls) {
  return Promise.all(fotos.map(async f => {
    const b = await sync.getPhoto(obra.id, f.id);
    if (!b) return '';
    const u = URL.createObjectURL(b); urls.push(u); return u;
  }));
}

async function vCapturar(id) {
  let rec;
  if (id) {
    rec = await db.get('records', id);
    if (!rec || rec.borrado) { location.replace('#/historial'); return; }
    if (!editable(rec)) { location.replace('#/ver/' + id); return; }
  } else {
    rec = await db.kvGet('draft:' + obra.id);
    if (!rec) rec = { id: uid(), obraId: obra.id, fecha: C.hoy(), cantidades: {}, tuberia: {}, avanceGrupos: {}, fotos: [], creado: Date.now() };
  }
  const esBorrador = !id;
  const autor = rec.autor || ses().usuario.nombre;
  const otros = records.filter(r => r.id !== rec.id && !r.borrado);
  const modoP = C.porPartidas(obra);
  const ultimoGrupo = g => { const rs = otros.filter(r => r.avanceGrupos?.[g] !== undefined).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); return rs[0]?.avanceGrupos[g]; };
  const T = modoP ? null : C.tuberia(obra, otros, C.hoy());
  const EJ = modoP && gestor() ? C.ejecutado(obra, otros, '9999-12-31') : {};
  const urls = [];
  const thumbs = await miniaturas(rec.fotos, urls);
  const frentes = obra.frentes?.length ? obra.frentes : [...new Set((obra.tramos || []).map(t => t.frente))];
  const puedeQuitarFoto = f => gestor() || !rec._subido;
  const tramos = modoP ? [] : (obra.tramos || []);
  const gruposL = modoP ? [] : (obra.grupos || []);
  const K = new Map((obra.conceptos || []).map(k => [k.id, k]));
  let lineas = rec._lineas || Object.keys(rec.cantidades || {});
  const valores = { ...(rec.cantidades || {}) };

  main().innerHTML = `
  <h1>${esBorrador ? 'Nueva captura' : 'Editar captura'}</h1>
  <form id="f" class="form">
    <div class="dos">
      <label>Fecha<input type="date" name="fecha" value="${esc(rec.fecha)}" required></label>
      <div class="dato"><span>Capturista</span><b>${esc(autor)}</b></div>
    </div>
    ${modoP ? `<fieldset><legend>Avance de partidas (cantidad ejecutada en este periodo)</legend>
      ${frentes.length ? `<label>Frente<select name="frente"><option value="">—</option>${frentes.map(fr => `<option ${rec.frente === fr ? 'selected' : ''}>${esc(fr)}</option>`).join('')}</select></label>` : ''}
      <div id="lineas"></div>
      <div class="buscador">
        <input id="busca" type="search" placeholder="Buscar partida por clave o palabra…" autocomplete="off" autocorrect="off" spellcheck="false">
        <div id="resultados" class="resultados"></div>
      </div>
    </fieldset>` : ''}
    ${tramos.length ? `<fieldset><legend>Tubería instalada en este periodo (metros nuevos)</legend>
      ${tramos.map(t => { const r = T.tramos.find(x => x.id === t.id); return `
        <label>${esc(t.frente)} · ${esc(t.diametro)} ${gestor() ? `<span class="peq">(llevan ${C.fmtM(r.instalado)} de ${C.fmtM(t.longitud)})</span>` : ''}
        <input name="tub_${esc(t.id)}" inputmode="decimal" placeholder="0.00" value="${rec.tuberia?.[t.id] ?? ''}"></label>`; }).join('')}
    </fieldset>` : ''}
    <fieldset><legend>Obra</legend>
      <div class="dos">
        <label>Personal en obra<input name="personal" inputmode="numeric" value="${rec.personal ?? ''}"></label>
        <label>Días de atraso<input name="atrasosDias" inputmode="numeric" value="${rec.atrasosDias ?? ''}"></label>
      </div>
      ${gestor() ? `<label>Importe ejecutado acumulado ($) <span class="peq">opcional, para avance financiero</span><input name="importeEjecutado" inputmode="decimal" value="${rec.importeEjecutado ?? ''}"></label>` : ''}
    </fieldset>
    ${gruposL.length ? `<fieldset><legend>Avance real acumulado por grupo (%)</legend>
      ${gruposL.map(g => { const u = ultimoGrupo(g.id); return `<label>${esc(g.nombre)}<input name="grp_${esc(g.id)}" inputmode="decimal" placeholder="${u !== undefined ? 'último: ' + u + '%' : '0–100'}" value="${rec.avanceGrupos?.[g.id] ?? ''}"></label>`; }).join('')}
    </fieldset>` : ''}
    <fieldset><legend>Observaciones</legend>
      <label>Actividades de la próxima semana<textarea name="actividades" rows="3">${esc(rec.actividades)}</textarea></label>
      <label>Atrasos y problemática<textarea name="problematica" rows="3">${esc(rec.problematica)}</textarea></label>
      <label>Requerimientos y acuerdos<textarea name="requerimientos" rows="3">${esc(rec.requerimientos)}</textarea></label>
    </fieldset>
    <fieldset><legend>Fotografías</legend>
      <div class="fotos-ed">
        ${rec.fotos.map((f, i) => `<div class="foto-ed">
          ${thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : '<div class="sinfoto">Sin descargar</div>'}
          <select name="ff_${i}">${frentes.map(fr => `<option ${f.frente === fr ? 'selected' : ''}>${esc(fr)}</option>`).join('')}<option ${!frentes.includes(f.frente) ? 'selected' : ''} value="">Otro</option></select>
          <input name="fc_${i}" placeholder="Actividad" value="${esc(f.caption)}">
          ${puedeQuitarFoto(f) ? `<button type="button" class="quitar" data-i="${i}">Quitar</button>` : ''}</div>`).join('')}
      </div>
      <label class="btn sec">Tomar / agregar fotos<input type="file" id="files" accept="image/*" multiple hidden></label>
    </fieldset>
    <button class="btn grande" type="submit">Guardar</button>
    ${esBorrador ? '<button type="button" class="btn sec" id="descartar">Descartar borrador</button>'
      : gestor() ? '<button type="button" class="btn peligro" id="borrar">Eliminar captura</button>'
      : '<button type="button" class="btn peligro" id="descartarLocal">Descartar captura (aún no se sube)</button>'}
    <p class="peq">${gestor() ? 'Se guarda en este teléfono aunque no haya señal y se sube solo cuando regrese.'
      : 'Se guarda en este teléfono aunque no haya señal. Puedes corregirla hasta que se suba; después ya no se puede modificar.'}</p>
  </form>`;

  const form = $('#f');
  const leer = () => {
    const fd = new FormData(form);
    const o = { ...rec, fecha: fd.get('fecha'), autor };
    if (modoP) {
      o.cantidades = {};
      for (const lid of lineas) {
        const raw = fd.get('cant_' + lid);
        if (raw !== null) valores[lid] = raw;
        const v = num(valores[lid]);
        if (v !== undefined && !isNaN(v) && v !== 0) o.cantidades[lid] = v;
      }
      o._lineas = lineas.slice();
      if (fd.has('frente')) o.frente = fd.get('frente') || '';
    } else {
      o.tuberia = {}; o.avanceGrupos = {};
      for (const t of tramos) { const v = num(fd.get('tub_' + t.id)); if (v !== undefined && !isNaN(v)) o.tuberia[t.id] = v; }
      for (const g of gruposL) { const v = num(fd.get('grp_' + g.id)); if (v !== undefined && !isNaN(v)) o.avanceGrupos[g.id] = Math.max(0, Math.min(100, v)); }
    }
    for (const k of ['personal', 'atrasosDias', 'importeEjecutado']) { const v = num(fd.get(k)); if (v !== undefined && !isNaN(v)) o[k] = v; else if (k !== 'importeEjecutado' || gestor()) delete o[k]; }
    for (const k of ['actividades', 'problematica', 'requerimientos']) o[k] = fd.get(k) || '';
    o.fotos = rec.fotos.map((f, i) => ({ ...f, frente: fd.get('ff_' + i) ?? f.frente, caption: fd.get('fc_' + i) ?? f.caption }));
    return o;
  };
  const volver = () => { urls.forEach(URL.revokeObjectURL); vCapturar(esBorrador ? undefined : rec.id); };
  const guardarBorrador = () => { if (esBorrador) { rec = leer(); db.kvSet('draft:' + obra.id, rec); } };
  form.oninput = e => { if (e.target.id !== 'busca') guardarBorrador(); };

  // ---- Partidas: líneas capturadas y buscador ----
  if (modoP) {
    const ultimaRuta = rutaCorta;
    const corta = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const pintarLineas = () => {
      $('#lineas').innerHTML = lineas.length ? lineas.map(lid => {
        const k = K.get(lid);
        if (!k) return `<div class="linea"><div class="linea-t"><b>Partida que ya no está en el catálogo</b></div><button type="button" class="quitar-l" data-id="${esc(lid)}" aria-label="Quitar">✕</button></div>`;
        return `<div class="linea">
          <div class="linea-t"><b>${esc(k.clave)}</b> <span class="peq">${esc(ultimaRuta(k))}</span>
            <div class="peq">${esc(corta(k.descripcion, 90))}</div>
            ${gestor() ? `<div class="peq">Llevan ${C.fmtCant(EJ[lid] || 0)} de ${C.fmtCant(k.cantidad, k.unidad)}</div>` : ''}</div>
          <div class="linea-c"><input name="cant_${esc(lid)}" inputmode="decimal" placeholder="0" value="${esc(valores[lid] ?? '')}"><span>${esc(k.unidad)}</span></div>
          <button type="button" class="quitar-l" data-id="${esc(lid)}" aria-label="Quitar partida">✕</button>
        </div>`;
      }).join('') : '<p class="peq">Busca abajo la partida que trabajaste y anota la cantidad.</p>';
      $('#lineas').querySelectorAll('.quitar-l').forEach(b => b.onclick = () => {
        leer(); lineas = lineas.filter(x => x !== b.dataset.id); delete valores[b.dataset.id];
        pintarLineas(); guardarBorrador();
      });
    };
    // Partidas usadas antes por este usuario (o por todos, si es gestor): aparecen primero.
    const frecuencia = {};
    for (const r of otros) for (const k of Object.keys(r.cantidades || {})) frecuencia[k] = (frecuencia[k] || 0) + 1;
    const recientes = Object.keys(frecuencia).filter(k => K.has(k)).sort((a, b) => frecuencia[b] - frecuencia[a]);
    const normT = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const indice = obra.conceptos.map(k => ({ k, t: normT(`${k.clave} ${k.descripcion} ${k.ruta.join(' ')} ${k.unidad}`) }));
    const pintarResultados = () => {
      const q = normT($('#busca').value).trim();
      let lista;
      if (!q) lista = recientes.filter(id => !lineas.includes(id)).slice(0, 8).map(id => K.get(id));
      else {
        const tokens = q.split(/\s+/);
        lista = indice.filter(x => !lineas.includes(x.k.id) && tokens.every(t => x.t.includes(t))).slice(0, 30).map(x => x.k);
      }
      $('#resultados').innerHTML = (!q && lista.length ? '<div class="peq">Usadas recientemente</div>' : '') + lista.map(k => `
        <button type="button" class="res" data-id="${esc(k.id)}"><b>${esc(k.clave)}</b> · ${esc(ultimaRuta(k))} <span class="peq">(${esc(k.unidad)})</span><br><span class="peq">${esc(corta(k.descripcion, 110))}</span></button>`).join('')
        + (q && !lista.length ? '<p class="peq">Sin resultados.</p>' : '');
      $('#resultados').querySelectorAll('.res').forEach(b => b.onclick = () => {
        leer(); lineas.push(b.dataset.id); valores[b.dataset.id] = '';
        $('#busca').value = ''; pintarLineas(); pintarResultados(); guardarBorrador();
        form.querySelector(`[name="cant_${CSS.escape(b.dataset.id)}"]`)?.focus();
      });
    };
    $('#busca').oninput = pintarResultados;
    $('#busca').onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };
    pintarLineas(); pintarResultados();
  }

  $('#files').onchange = async e => {
    rec = leer();
    for (const file of e.target.files) {
      const blob = await comprimir(file);
      const fid = uid();
      // Se guardan los bytes (ArrayBuffer), no el Blob: en iPhone un Blob guardado
      // a veces ya no se puede volver a leer.
      await db.put('photos', { id: fid, obraId: obra.id, data: await blob.arrayBuffer(), type: 'image/jpeg', synced: false });
      rec.fotos.push({ id: fid, frente: frentes[0] || '', caption: '', fecha: rec.fecha });
    }
    if (esBorrador) await db.kvSet('draft:' + obra.id, rec); else await guardarRecord(rec);
    volver();
  };
  form.querySelectorAll('.quitar').forEach(b => b.onclick = async () => {
    rec = leer();
    const [f] = rec.fotos.splice(+b.dataset.i, 1);
    const ph = await db.get('photos', f.id);
    if (ph && !ph.synced) { await db.del('photos', f.id); await db.del('outbox', 'photo:' + f.id); }
    else if (gestor()) await db.enqueue('fotodel', f.id, obra.id);
    if (esBorrador) await db.kvSet('draft:' + obra.id, rec); else await guardarRecord(rec);
    volver();
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const o = leer();
    delete o._lineas;
    if (modoP) {
      const vacias = lineas.filter(l => o.cantidades[l] === undefined && K.has(l));
      if (vacias.length && !confirm(`${vacias.length} partida(s) no tienen cantidad y no se guardarán. ¿Continuar?`)) return;
    }
    await guardarRecord(o);
    if (esBorrador) await db.del('kv', 'draft:' + obra.id);
    toast('Captura guardada');
    location.hash = '#/historial';
  };
  $('#descartar')?.addEventListener('click', async () => {
    if (!confirm('¿Descartar este borrador?')) return;
    for (const f of rec.fotos) await db.del('photos', f.id);
    await db.del('kv', 'draft:' + obra.id);
    vCapturar();
  });
  $('#descartarLocal')?.addEventListener('click', async () => {
    const actual = await db.get('records', rec.id);
    if (actual?._subido) { toast('Ya se subió; no se puede descartar'); location.hash = '#/ver/' + rec.id; return; }
    if (!confirm('¿Descartar esta captura? Todavía no se ha subido.')) return;
    for (const f of rec.fotos) { await db.del('photos', f.id); await db.del('outbox', 'photo:' + f.id); }
    await db.del('outbox', 'record:' + rec.id);
    await db.del('records', rec.id);
    await sync.markChanged(); await cargar();
    location.hash = '#/historial';
  });
  $('#borrar')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta captura? Se quitará también para los demás.')) return;
    await guardarRecord({ ...rec, borrado: true });
    location.hash = '#/historial';
  });
}

// Vista de solo lectura (capturas ya subidas, para el supervisor).
async function vDetalle(id) {
  const rec = await db.get('records', id);
  if (!rec || rec.borrado) { location.replace('#/historial'); return; }
  if (editable(rec)) { location.replace('#/capturar/' + id); return; }
  const urls = [];
  const thumbs = await miniaturas(rec.fotos || [], urls);
  const fila = (k, v) => (v === undefined || v === '' ? '' : `<tr><td>${k}</td><td class="r">${esc(v)}</td></tr>`);
  main().innerHTML = `<h1>Captura del ${C.fechaCorta(rec.fecha)}</h1>
  <p class="peq">${esc(rec.autor || '')} · Ya se subió; no se puede modificar.</p>
  <div class="tarjeta"><table><tbody>
    ${fila('Frente', rec.frente)}
    ${Object.entries(rec.cantidades || {}).map(([kid, v]) => { const k = (obra.conceptos || []).find(x => x.id === kid); return k ? `<tr><td><b>${esc(k.clave)}</b> <span class="peq">${esc(rutaCorta(k))}</span><div class="peq">${esc(k.descripcion.slice(0, 100))}</div></td><td class="r">${esc(C.fmtCant(v, k.unidad))}</td></tr>` : ''; }).join('')}
    ${(obra.tramos || []).map(t => fila(`Tubería ${esc(t.frente)} · ${esc(t.diametro)}`, rec.tuberia?.[t.id] !== undefined ? C.fmtM(rec.tuberia[t.id]) : '')).join('')}
    ${fila('Personal en obra', rec.personal)}${fila('Días de atraso', rec.atrasosDias)}
    ${(obra.grupos || []).map(g => fila(esc(g.nombre), rec.avanceGrupos?.[g.id] !== undefined ? rec.avanceGrupos[g.id] + '%' : '')).join('')}
  </tbody></table></div>
  ${[['Actividades de la próxima semana', rec.actividades], ['Atrasos y problemática', rec.problematica], ['Requerimientos y acuerdos', rec.requerimientos]].filter(x => x[1]?.trim()).map(([t, v]) => `<div class="tarjeta"><h3>${t}</h3><p>${esc(v)}</p></div>`).join('')}
  ${(rec.fotos || []).length ? `<div class="galeria">${rec.fotos.map((f, i) => `<figure><div class="ph">${thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : 'Se descarga con señal'}</div><figcaption>${esc(f.frente)} ${f.caption ? '· ' + esc(f.caption) : ''}</figcaption></figure>`).join('')}</div>` : ''}
  <a class="btn sec" href="#/historial">Volver</a>`;
}

function vHistorial() {
  const rs = records.filter(r => !r.borrado).sort((a, b) => (a.fecha === b.fecha ? (b.creado || 0) - (a.creado || 0) : a.fecha < b.fecha ? 1 : -1));
  main().innerHTML = `<h1>${gestor() ? 'Capturas' : 'Mis capturas'}</h1>
  ${rs.length ? rs.map(r => {
    const m = Object.values(r.tuberia || {}).reduce((s, v) => s + (+v || 0), 0);
    const np = Object.keys(r.cantidades || {}).length;
    return `<a class="tarjeta item" href="#/${editable(r) ? 'capturar' : 'ver'}/${r.id}">
      <div class="fila"><b>${C.fechaCorta(r.fecha)}${gestor() ? ' · ' + esc(r.autor || 'Sin nombre') : ''}</b><span class="chip ${r._subido && r._sync === 'ok' ? 'ok' : 'pend'}">${r._subido && r._sync === 'ok' ? 'En la nube' : 'Por subir'}</span></div>
      <div class="peq">${np ? np + (np === 1 ? ' partida · ' : ' partidas · ') : ''}${r.frente ? esc(r.frente) + ' · ' : ''}${m ? C.fmtM(m) + ' de tubería · ' : ''}${r.personal !== undefined ? r.personal + ' personas · ' : ''}${(r.fotos || []).length} fotos</div></a>`;
  }).join('') : '<p class="peq">Aún no hay capturas.</p>'}
  <a class="btn grande" href="#/capturar">+ Nueva captura</a>`;
}

async function vFotos() {
  const fs = records.filter(r => !r.borrado).flatMap(r => (r.fotos || []).map(f => ({ ...f, fecha: f.fecha || r.fecha, autor: r.autor }))).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  main().innerHTML = `<h1>${gestor() ? 'Fotografías' : 'Mis fotografías'}</h1><div class="galeria">${fs.map(f => `<figure data-id="${f.id}"><div class="ph"></div><figcaption>${esc(f.frente)} ${f.caption ? '· ' + esc(f.caption) : ''}<br><span class="peq">${C.fechaCorta(f.fecha)}${gestor() ? ' · ' + esc(f.autor || '') : ''}</span></figcaption></figure>`).join('') || '<p class="peq">Sin fotos.</p>'}</div>`;
  for (const fig of main().querySelectorAll('figure')) {
    sync.getPhoto(obra.id, fig.dataset.id).then(b => {
      const ph = fig.querySelector('.ph');
      if (b) { const u = URL.createObjectURL(b); ph.innerHTML = `<img src="${u}" alt="">`; ph.onclick = () => window.open(u); }
      else ph.textContent = navigator.onLine ? 'No disponible' : 'Se descarga con señal';
    });
  }
}

// ---------- Cuenta ----------
function vCuenta() {
  if (sync.state.needsLogin) return vLoginRenovar();
  const s = ses(), st = sync.state;
  main().innerHTML = `<h1>Mi cuenta</h1>
  <div class="tarjeta"><table><tbody>
    <tr><td>Nombre</td><td class="r">${esc(s.usuario.nombre)}</td></tr>
    <tr><td>Usuario</td><td class="r">${esc(s.usuario.usuario)}</td></tr>
    <tr><td>Rol</td><td class="r">${ROL_NOMBRE[s.usuario.rol]}</td></tr>
    <tr><td>Obra actual</td><td class="r"><a href="#/obra">${esc(s.obras.find(o => o.id === settings.obraId)?.nombre || 'Elegir')}</a></td></tr>
    <tr><td>Por subir</td><td class="r">${st.pending}</td></tr>
    <tr><td>Última sincronización</td><td class="r">${st.lastSync ? new Date(st.lastSync).toLocaleString('es-MX') : '—'}</td></tr>
  </tbody></table></div>
  <button class="btn sec" id="sincro">Sincronizar ahora</button>
  <button class="btn peligro" id="salir">Cerrar sesión</button>
  <p class="peq">Versión ${window.APP_VERSION}</p>`;
  $('#sincro').onclick = () => { pedirSync(); toast(navigator.onLine ? 'Sincronizando…' : 'Sin señal: se subirá cuando regrese'); };
  $('#salir').onclick = async () => {
    const p = sync.state.pending;
    if (p && !confirm(`Hay ${p} cambios sin subir. Si cierras sesión SE PERDERÁN. ¿Cerrar sesión de todos modos?`)) return;
    if (!p && !confirm('¿Cerrar sesión en este teléfono?')) return;
    await sync.logout();
    location.hash = '';
    await cargar();
    render();
  };
}

function vLoginRenovar() {
  vLogin(true);
}

// ---------- Portal del administrador ----------
async function vAdmin(sub = 'usuarios', id, q) {
  const tabs = [['usuarios', 'Usuarios'], ['obras', 'Obras'], ['onedrive', 'OneDrive']];
  const activo = sub === 'usuario' ? 'usuarios' : sub === 'obra' ? 'obras' : sub;
  main().innerHTML = `<h1>Administración</h1>
  <div class="tabs">${tabs.map(([k, t]) => `<a href="#/admin/${k}" class="${k === activo ? 'activo' : ''}">${t}</a>`).join('')}</div>
  <div id="adm"><p class="peq">Cargando…</p></div>`;
  if (!navigator.onLine) { $('#adm').innerHTML = '<p>El portal necesita señal.</p>'; return; }
  try {
    if (sub === 'usuarios') await admUsuarios();
    else if (sub === 'usuario') await admUsuario(id);
    else if (sub === 'obras') await admObras();
    else if (sub === 'obra') await admObra(id);
    else if (sub === 'onedrive') await admOneDrive(q);
    else location.replace('#/admin/usuarios');
  } catch (e) {
    $('#adm').innerHTML = `<p class="neg">${esc(e.message)}</p>`;
  }
}

async function admUsuarios() {
  const [{ usuarios }, { obras }] = await Promise.all([sync.api('/admin/usuarios'), sync.api('/admin/obras')]);
  const nombreObra = id => obras.find(o => o.id === id)?.nombre || id;
  $('#adm').innerHTML = `<a class="btn" href="#/admin/usuario/nuevo">+ Nuevo usuario</a>
  ${usuarios.map(u => `<a class="tarjeta item" href="#/admin/usuario/${u.id}">
    <div class="fila"><b>${esc(u.nombre)}</b><span class="chip ${u.activo ? 'ok' : 'pend'}">${u.activo ? ROL_NOMBRE[u.rol] : 'Desactivado'}</span></div>
    <div class="peq">${esc(u.usuario)} · ${u.rol === 'admin' ? 'Todas las obras' : (u.obras.map(nombreObra).map(esc).join(', ') || 'Sin obras asignadas')}</div></a>`).join('')}`;
}

async function admUsuario(id) {
  const nuevo = id === 'nuevo';
  const [{ usuarios }, { obras }] = await Promise.all([sync.api('/admin/usuarios'), sync.api('/admin/obras')]);
  const u = nuevo ? { nombre: '', usuario: '', rol: 'supervisor', activo: true, obras: [] } : usuarios.find(x => x.id === id);
  if (!u) { location.replace('#/admin/usuarios'); return; }
  $('#adm').innerHTML = `<form id="fu" class="form">
    <fieldset><legend>${nuevo ? 'Nuevo usuario' : 'Editar usuario'}</legend>
      <label>Nombre completo<input name="nombre" value="${esc(u.nombre)}" required></label>
      <label>Usuario (para entrar)<input name="usuario" value="${esc(u.usuario)}" ${nuevo ? 'required' : 'disabled'} autocapitalize="none" autocorrect="off" spellcheck="false" pattern="[a-zA-Z0-9._\\-]{3,40}" title="Letras, números, punto, guion o guion bajo (3 a 40)"></label>
      <label>Rol<select name="rol">${['supervisor', 'gerente', 'admin'].map(r => `<option value="${r}" ${u.rol === r ? 'selected' : ''}>${ROL_NOMBRE[r]}</option>`).join('')}</select></label>
      <p class="peq" id="rolAyuda"></p>
      <label>${nuevo ? 'Contraseña' : 'Nueva contraseña'} <span class="peq">${nuevo ? 'mínimo 8 caracteres' : '(déjala vacía para no cambiarla)'}</span><input name="password" type="text" autocomplete="new-password" ${nuevo ? 'required' : ''} minlength="8"></label>
      ${nuevo ? '' : `<label class="check"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''}> Activo (puede entrar)</label>`}
    </fieldset>
    <fieldset id="fsObras"><legend>Obras asignadas</legend>
      ${obras.map(o => `<label class="check"><input type="checkbox" name="obra" value="${esc(o.id)}" ${u.obras.includes(o.id) ? 'checked' : ''}> ${esc(o.nombre)}${o.activa ? '' : ' <span class="peq">(inactiva)</span>'}</label>`).join('') || '<p class="peq">Aún no hay obras.</p>'}
    </fieldset>
    <p id="errU" class="neg"></p>
    <button class="btn grande">Guardar</button>
    <a class="btn sec" href="#/admin/usuarios">Cancelar</a>
  </form>`;
  const f = $('#fu');
  const ayuda = { supervisor: 'Solo captura y sube fotos en sus obras. Ve únicamente sus propias capturas y fotos; no puede modificar ni borrar lo que ya subió.', gerente: 'Ve el tablero y todas las capturas de sus obras; puede editar y eliminar capturas y fotos de esas obras.', admin: 'Acceso total: todas las obras, usuarios y este portal.' };
  const pintarRol = () => { $('#rolAyuda').textContent = ayuda[f.rol.value]; $('#fsObras').hidden = f.rol.value === 'admin'; };
  f.rol.onchange = pintarRol; pintarRol();
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const datos = { nombre: fd.get('nombre').trim(), rol: fd.get('rol'), obras: fd.getAll('obra') };
    if (fd.get('password')) datos.password = fd.get('password');
    try {
      if (nuevo) await sync.api('/admin/usuarios', { method: 'POST', json: { ...datos, usuario: fd.get('usuario').trim() } });
      else await sync.api('/admin/usuarios/' + id, { method: 'PUT', json: { ...datos, activo: !!fd.get('activo') } });
      toast('Usuario guardado');
      location.hash = '#/admin/usuarios';
    } catch (err) { $('#errU').textContent = err.message; }
  };
}

async function admObras() {
  const { obras } = await sync.api('/admin/obras');
  $('#adm').innerHTML = `<a class="btn" href="#/admin/obra/nueva">+ Nueva obra</a>
  ${obras.map(o => `<a class="tarjeta item" href="#/admin/obra/${esc(o.id)}">
    <div class="fila"><b>${esc(o.nombre)}</b><span class="chip ${o.activa ? 'ok' : 'pend'}">${o.activa ? 'Activa' : 'Inactiva'}</span></div>
    <div class="peq">${esc(o.localidad || '')} · ${C.fechaCorta(o.inicio)} al ${C.fechaCorta(o.fin)}</div></a>`).join('') || '<p class="peq">Aún no hay obras. Si ya tenías datos en OneDrive, impórtalos en la pestaña OneDrive.</p>'}`;
}

const OBRA_VACIA = { nombre: '', localidad: '', cliente: '', concurso: '', fechaConcurso: '', inicio: C.hoy(), fin: C.hoy(), montoTotal: 0, programaMensual: [], grupos: [], conceptos: [], tramos: [], activa: true };

async function admObra(id) {
  const nueva = id === 'nueva';
  const { obras } = await sync.api('/admin/obras');
  const o = nueva ? { ...OBRA_VACIA } : obras.find(x => x.id === id);
  if (!o) { location.replace('#/admin/obras'); return; }
  o.tramos ||= []; o.grupos ||= []; o.programaMensual ||= []; o.conceptos ||= [];
  // Catálogo en edición (cambia al importar sin recargar el resto del formulario).
  const cat = {
    conceptos: o.conceptos, nivelGrupo: o.nivelGrupo, frentes: o.frentes || [],
    destacados: [...(o.destacados || [])], etiquetas: { ...(o.etiquetas || {}) },
    inicial: { ...(o.inicial || {}) }, mapaLegado: { ...(o.mapaLegado || {}) },
  };
  $('#adm').innerHTML = `<form id="fo" class="form">
    <fieldset><legend>Generales</legend>
      <label>Nombre<input name="nombre" value="${esc(o.nombre)}" required></label>
      ${nueva ? '<label>Identificador <span class="peq">(se genera del nombre; no se puede cambiar después)</span><input name="id" pattern="[a-z0-9\\-]{3,60}" required></label>' : `<p class="peq">Identificador: ${esc(o.id)}</p>`}
      <label>Localidad<input name="localidad" value="${esc(o.localidad)}"></label>
      <label>Cliente<input name="cliente" value="${esc(o.cliente)}"></label>
      <div class="dos"><label>Concurso No.<input name="concurso" value="${esc(o.concurso)}"></label><label>Fecha concurso<input type="date" name="fechaConcurso" value="${esc(o.fechaConcurso)}"></label></div>
      <div class="dos"><label>Inicio de obra<input type="date" name="inicio" value="${esc(o.inicio)}" required></label><label>Fin de obra<input type="date" name="fin" value="${esc(o.fin)}" required></label></div>
      <label>Monto total del programa ($)<input name="montoTotal" inputmode="decimal" value="${o.montoTotal ?? 0}"></label>
      <label class="check"><input type="checkbox" name="activa" ${o.activa !== false ? 'checked' : ''}> Obra activa (visible para los usuarios asignados)</label>
    </fieldset>
    <fieldset><legend>Catálogo y programa de obra</legend>
      <div id="catResumen"></div>
      <label class="btn sec">Importar Excel del programa (AE10) o presupuesto<input type="file" id="xls" accept=".xlsx,.xls,.xlsm" hidden></label>
      <div id="vistaPrevia"></div>
    </fieldset>
    <div id="catDetalle"></div>
    <details class="manual" ${cat.conceptos.length ? '' : 'open'}><summary>Modo manual (obras sin catálogo importado)</summary>
      <fieldset><legend>Tramos de tubería</legend>
        <p class="peq">Una línea por tramo: Frente | Diámetro | Longitud total (m) | Nota de zanja | Metros instalados iniciales | Fecha inicial</p>
        <textarea name="tramos" rows="4">${esc(o.tramos.map(t => [t.frente, t.diametro, t.longitud, t.zanja || '', t.inicial?.metros ?? '', t.inicial?.fecha ?? ''].join(' | ')).join('\n'))}</textarea>
      </fieldset>
      <fieldset><legend>Grupos de conceptos</legend>
        <p class="peq">Una línea por grupo: Nombre | Importe</p>
        <textarea name="grupos" rows="6">${esc(o.grupos.map(g => `${g.nombre} | ${g.importe}`).join('\n'))}</textarea>
      </fieldset>
      <fieldset><legend>Programa mensual</legend>
        <p class="peq">Una línea por mes: AAAA-MM | Monto</p>
        <textarea name="mensual" rows="3">${esc(o.programaMensual.map(m => `${m.mes} | ${m.monto}`).join('\n'))}</textarea>
      </fieldset>
    </details>
    <p id="errObra" class="neg"></p>
    <button class="btn grande">Guardar obra</button>
    <a class="btn sec" href="#/admin/obras">Cancelar</a>
  </form>`;
  const f = $('#fo');
  const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (nueva) f.nombre.oninput = () => { if (!f.id.dataset.tocado) f.id.value = slug(f.nombre.value); };
  if (nueva) f.id.oninput = () => { f.id.dataset.tocado = '1'; };
  const fecha = s => { s = String(s).trim(); const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; throw new Error('Fecha no válida: ' + s); };
  const lineasTxt = t => t.split('\n').map(l => l.trim()).filter(Boolean);
  const ultimaRuta = k => (k.ruta?.length ? k.ruta[k.ruta.length - 1] : '');

  // Lee del formulario lo que el administrador ya ajustó del catálogo.
  const leerCat = () => {
    if (!cat.conceptos.length || !$('#catDetalle fieldset')) return;
    const fd = new FormData(f);
    cat.nivelGrupo = +fd.get('nivelGrupo') || cat.nivelGrupo;
    cat.frentes = lineasTxt(fd.get('frentes') || '');
    cat.destacados = fd.getAll('destacado');
    cat.etiquetas = {}; cat.inicial = {};
    const fechaIni = fd.get('fechaInicial') || f.inicio.value;
    for (const k of cat.conceptos) {
      const et = (fd.get('et_' + k.id) || '').trim();
      if (et) cat.etiquetas[k.id] = et;
      const ini = num(fd.get('ini_' + k.id));
      if (ini !== undefined && !isNaN(ini) && ini !== 0) cat.inicial[k.id] = { cantidad: ini, fecha: fechaIni };
    }
    cat.mapaLegado = {};
    for (const t of o.tramos) { const v = fd.get('leg_' + t.id); if (v) cat.mapaLegado[t.id] = v; }
  };

  const pintarCat = () => {
    const ks = cat.conceptos;
    const total = ks.reduce((s, k) => s + k.importe, 0);
    $('#catResumen').innerHTML = ks.length
      ? `<p><b>${ks.length} partidas</b> · ${C.fmtMoney(total, 2)} · ${ks.filter(k => k.inicio).length} con fechas de programa</p><button type="button" class="btn peligro" id="quitarCat">Quitar catálogo (volver a modo manual)</button>`
      : '<p class="peq">Sin catálogo. Importa el Excel del programa de obra (AE10) para calcular el avance por partida.</p>';
    $('#quitarCat')?.addEventListener('click', () => {
      if (!confirm('¿Quitar el catálogo de esta obra? Las capturas por partida dejarán de contar hasta que lo vuelvas a importar.')) return;
      cat.conceptos = []; pintarCat();
    });
    if (!ks.length) { $('#catDetalle').innerHTML = ''; return; }
    const prof = Math.max(1, ...ks.map(k => k.ruta.length));
    const nivel = Math.min(cat.nivelGrupo || 1, prof);
    const gruposEn = n => [...new Set(ks.map(k => C.grupoDe(k, n)))];
    const fechaIni = Object.values(cat.inicial)[0]?.fecha || o.tramos.find(t => t.inicial?.fecha)?.inicial.fecha || C.hoy();
    const unidadesM = new Set(['M', 'ML', 'M.L.', 'MTS', 'METRO']);
    const sugerir = t => {
      const d = String(t.diametro || '').replace(/[^\d.]/g, '');
      return ks.find(k => unidadesM.has(k.unidad.toUpperCase()) && d && new RegExp(`(^|\\D)${d.replace('.', '\\.')}\\s*(\"|″|”|PULG)`, 'i').test(k.ruta.join(' ') + ' ' + k.descripcion))?.id || '';
    };
    $('#catDetalle').innerHTML = `
    <fieldset><legend>Agrupación del tablero</legend>
      <label>Nivel de los grupos<select name="nivelGrupo">${Array.from({ length: prof }, (_, i) => i + 1).map(n => { const g = gruposEn(n); return `<option value="${n}" ${n === nivel ? 'selected' : ''}>Nivel ${n} — ${g.length} grupos (${esc(g.slice(0, 3).join(', '))}${g.length > 3 ? '…' : ''})</option>`; }).join('')}</select></label>
    </fieldset>
    <fieldset><legend>Frentes de trabajo</legend>
      <p class="peq">Uno por línea (opcional). El supervisor elige el frente al capturar.</p>
      <textarea name="frentes" rows="3">${esc(cat.frentes.join('\n'))}</textarea>
    </fieldset>
    ${o.tramos.length ? `<fieldset><legend>Capturas anteriores de tubería</legend>
      <p class="peq">Las capturas hechas antes del catálogo registraron metros por tramo. Elige a qué partida corresponde cada tramo para que sigan contando.</p>
      ${o.tramos.map(t => { const sel = cat.mapaLegado[t.id] || sugerir(t); return `<label>${esc(t.frente)} · ${esc(t.diametro)}<select name="leg_${esc(t.id)}" data-ini="${t.inicial?.metros ?? ''}"><option value="">— No contar —</option>${ks.filter(k => unidadesM.has(k.unidad.toUpperCase())).map(k => `<option value="${esc(k.id)}" ${k.id === sel ? 'selected' : ''}>${esc(k.clave)} · ${esc(ultimaRuta(k))}</option>`).join('')}</select></label>`; }).join('')}
    </fieldset>` : ''}
    <fieldset><legend>Partidas</legend>
      <p class="peq">Marca las <b>destacadas</b> para verlas como indicador en el tablero y el reporte (por ejemplo la tubería o los pozos). El <b>avance inicial</b> es lo ejecutado antes de empezar a capturar en la app.</p>
      <label>Fecha del avance inicial<input type="date" name="fechaInicial" value="${esc(fechaIni)}"></label>
      <input type="search" id="filtroP" placeholder="Filtrar partidas…" autocomplete="off">
      <div class="tabla-partidas">
      ${ks.map(k => { const d = cat.destacados.includes(k.id); return `<div class="fila-partida" data-t="${esc((k.clave + ' ' + k.descripcion + ' ' + k.ruta.join(' ')).toLowerCase())}">
        <label class="check"><input type="checkbox" name="destacado" value="${esc(k.id)}" ${d ? 'checked' : ''}> <span><b>${esc(k.clave)}</b> · ${esc(ultimaRuta(k))}<br><span class="peq">${esc(k.descripcion.slice(0, 110))}${k.descripcion.length > 110 ? '…' : ''}</span><br><span class="peq">${C.fmtCant(k.cantidad, k.unidad)} · ${C.fmtMoney(k.importe)}${k.inicio ? ` · ${C.fechaCorta(k.inicio)} al ${C.fechaCorta(k.fin)}` : ''}</span></span></label>
        <div class="dos">
          <label>Etiqueta en el tablero<input name="et_${esc(k.id)}" value="${esc(cat.etiquetas[k.id] || '')}" placeholder="${esc(ultimaRuta(k) || k.clave)}"></label>
          <label>Avance inicial (${esc(k.unidad)})<input name="ini_${esc(k.id)}" inputmode="decimal" value="${cat.inicial[k.id]?.cantidad ?? ''}" placeholder="0"></label>
        </div></div>`; }).join('')}
      </div>
    </fieldset>`;
    $('#filtroP').oninput = e => {
      const q = e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      $('#catDetalle').querySelectorAll('.fila-partida').forEach(el => { el.hidden = !!q && !el.dataset.t.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q); });
    };
    // Al ligar un tramo antiguo, sus metros iniciales pasan al avance inicial de la partida.
    $('#catDetalle').querySelectorAll('select[name^="leg_"]').forEach(s => {
      const pasar = () => { const inp = f.elements['ini_' + s.value]; if (s.value && inp && !inp.value && s.dataset.ini) inp.value = s.dataset.ini; };
      s.onchange = pasar; pasar();
    });
  };
  pintarCat();

  $('#xls').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    $('#vistaPrevia').innerHTML = '<p class="peq">Leyendo el archivo…</p>';
    try {
      const { leerArchivo } = await import('./ae10.js');
      const r = await leerArchivo(file);
      const nivel = r.nivelSugerido;
      const grupos = [...new Set(r.conceptos.map(k => C.grupoDe(k, nivel)))];
      const g = r.generales;
      const conservados = cat.conceptos.length ? r.conceptos.filter(k => cat.conceptos.some(x => x.id === k.id)).length : 0;
      $('#vistaPrevia').innerHTML = `<div class="tarjeta vista">
        <h3>${esc(file.name)}</h3>
        <p><b>${r.conceptos.length} partidas</b> · total ${C.fmtMoney(r.total, 2)}${r.periodos.length ? ` · programa en ${r.periodos.length} periodos` : ''}</p>
        ${g.inicio ? `<p class="peq">Obra del ${C.fechaCorta(g.inicio)} al ${C.fechaCorta(g.fin)}${g.concurso ? ' · Concurso ' + esc(g.concurso) : ''}</p>` : ''}
        ${r.avisos.map(a => `<p class="nota">${esc(a)}</p>`).join('')}
        <p class="peq">${grupos.length} grupos: ${esc(grupos.slice(0, 6).join(' · '))}${grupos.length > 6 ? '…' : ''}</p>
        ${cat.conceptos.length ? `<p class="peq">${conservados} de ${r.conceptos.length} partidas coinciden con el catálogo actual; su avance capturado se conserva.</p>` : ''}
        <button type="button" class="btn" id="usarXls">Usar este archivo</button>
        <button type="button" class="btn sec" id="cancelarXls">Cancelar</button>
      </div>`;
      $('#cancelarXls').onclick = () => { $('#vistaPrevia').innerHTML = ''; };
      $('#usarXls').onclick = () => {
        leerCat();
        const ids = new Set(r.conceptos.map(k => k.id));
        cat.conceptos = r.conceptos;
        cat.nivelGrupo = nivel;
        cat.destacados = cat.destacados.filter(x => ids.has(x));
        for (const m of ['etiquetas', 'inicial']) cat[m] = Object.fromEntries(Object.entries(cat[m]).filter(([x]) => ids.has(x)));
        for (const [k, v] of Object.entries({ nombre: g.nombre, localidad: g.localidad, cliente: g.cliente, concurso: g.concurso, fechaConcurso: g.fechaConcurso })) if (v && !f[k].value) f[k].value = v;
        if (g.inicio) f.inicio.value = g.inicio;
        if (g.fin) f.fin.value = g.fin;
        f.montoTotal.value = r.total;
        $('#vistaPrevia').innerHTML = '<p class="pos">Catálogo cargado. Revisa las partidas destacadas y presiona "Guardar obra".</p>';
        f.querySelector('details.manual').open = false;
        pintarCat();
      };
    } catch (err) {
      $('#vistaPrevia').innerHTML = `<p class="neg">${esc(err.message)}</p>`;
    }
  };

  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    try {
      leerCat();
      const n = { ...o };
      for (const k of ['nombre', 'localidad', 'cliente', 'concurso', 'fechaConcurso', 'inicio', 'fin']) n[k] = fd.get(k);
      n.montoTotal = num(fd.get('montoTotal')) || 0;
      n.activa = !!fd.get('activa');
      n.tramos = lineasTxt(fd.get('tramos')).map((l, i) => {
        const [frente, diametro, lon, zanja, mi, fi] = l.split('|').map(x => x.trim());
        const prev = o.tramos.find(t => t.frente === frente && t.diametro === diametro) || null;
        const idT = prev ? prev.id : (slug(frente + '-' + diametro) || 't' + i);
        return { id: idT, frente, diametro, longitud: num(lon), zanja, ...(mi ? { inicial: { metros: num(mi), fecha: fi ? fecha(fi) : n.inicio } } : {}) };
      });
      n.grupos = lineasTxt(fd.get('grupos')).map((l, i) => {
        const [nombre, imp] = l.split('|').map(x => x.trim());
        const prev = o.grupos.find(g => g.nombre === nombre);
        return { id: prev ? prev.id : (slug(nombre).replace(/-/g, '').slice(0, 12) || 'g' + i), nombre, importe: num(imp) };
      });
      n.programaMensual = lineasTxt(fd.get('mensual')).map(l => { const [mes, m] = l.split('|').map(x => x.trim()); if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes no válido: ' + mes); return { mes, monto: num(m) }; });
      if ([...n.tramos.map(t => t.longitud), ...n.grupos.map(g => g.importe), ...n.programaMensual.map(m => m.monto)].some(v => v === undefined || isNaN(v))) throw new Error('Hay un número no válido en el modo manual.');
      n.conceptos = cat.conceptos;
      if (cat.conceptos.length) {
        Object.assign(n, { nivelGrupo: cat.nivelGrupo, frentes: cat.frentes, destacados: cat.destacados, etiquetas: cat.etiquetas, inicial: cat.inicial, mapaLegado: cat.mapaLegado });
      } else {
        for (const k of ['nivelGrupo', 'destacados', 'etiquetas', 'inicial', 'mapaLegado']) delete n[k];
      }
      const oid = nueva ? fd.get('id').trim() : o.id;
      if (nueva && obras.some(x => x.id === oid)) throw new Error('Ya existe una obra con ese identificador.');
      const r = await sync.api('/admin/obras/' + oid, { method: 'PUT', json: n });
      if (oid === settings.obraId) await db.kvSet('obra:' + oid, { ...n, id: oid, updatedAt: r.updatedAt });
      toast('Obra guardada');
      pedirSync();
      location.hash = '#/admin/obras';
    } catch (err) { $('#errObra').textContent = err.message; }
  };
}

async function admOneDrive(q) {
  const res = q?.get('resultado');
  const msg = { ok: 'OneDrive conectado.', cancelado: 'Se canceló la conexión.', expirado: 'El enlace de conexión venció; inténtalo de nuevo.', error: 'No se pudo conectar OneDrive. Inténtalo de nuevo.' }[res];
  const e = await sync.api('/admin/onedrive');
  $('#adm').innerHTML = `${msg ? `<p class="${res === 'ok' ? 'pos' : 'neg'}">${msg}</p>` : ''}
  <div class="tarjeta">
    <h3>${e.conectado ? 'Conectado' : 'No conectado'}</h3>
    <p class="peq">${e.conectado ? `Cuenta: ${esc(e.cuenta?.nombre || '')} ${esc(e.cuenta?.correo || '')}<br>Las capturas y fotos se guardan en la carpeta REMA-Reportes de esa cuenta.`
      : 'Conecta el OneDrive donde se guardarán las capturas y fotos. Solo se hace una vez; los demás usuarios no necesitan cuenta de Microsoft.'}</p>
  </div>
  <button class="btn" id="conectar">${e.conectado ? 'Volver a conectar' : 'Conectar OneDrive'}</button>
  ${e.conectado ? `<button class="btn sec" id="importar">Importar datos que ya estaban en OneDrive</button>
  <button class="btn sec" id="respaldar">Respaldar pendientes en OneDrive</button>
  <button class="btn peligro" id="desconectar">Desconectar OneDrive</button>` : ''}
  <p id="resOD" class="peq"></p>`;
  $('#conectar').onclick = async () => { try { location.href = (await sync.api('/admin/onedrive/iniciar', { method: 'POST' })).url; } catch (err) { $('#resOD').textContent = err.message; } };
  $('#importar')?.addEventListener('click', async ev => {
    ev.target.disabled = true; $('#resOD').textContent = 'Importando…';
    try { const r = await sync.api('/admin/importar', { method: 'POST' }); $('#resOD').textContent = `Importado: ${r.obras} obras, ${r.capturas} capturas, ${r.fotos} fotos. Asigna las obras a los usuarios en la pestaña Usuarios.`; pedirSync(); }
    catch (err) { $('#resOD').textContent = err.message; }
    ev.target.disabled = false;
  });
  $('#respaldar')?.addEventListener('click', async () => {
    try { const r = await sync.api('/admin/respaldar', { method: 'POST' }); $('#resOD').textContent = `Respaldadas: ${r.procesadas}. Pendientes: ${r.pendientes}.`; }
    catch (err) { $('#resOD').textContent = err.message; }
  });
  $('#desconectar')?.addEventListener('click', async () => {
    if (!confirm('¿Desconectar OneDrive? No se podrán subir fotos hasta volver a conectarlo.')) return;
    await sync.api('/admin/onedrive/desconectar', { method: 'POST' });
    admOneDrive();
  });
}

function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('ver');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('ver'), 2200);
}

// ---------- Arranque ----------
async function start() {
  await sync.init();
  await cargar();
  sync.onChange(st => { pintarEstado(st); });
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { pintarEstado(); pedirSync(); });
  window.addEventListener('offline', () => pintarEstado());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirSync(); });
  setInterval(() => { if (navigator.onLine) pedirSync(); }, 60000);
  render();
  pedirSync();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Nueva versión lista: cierra y vuelve a abrir la app'); });
    });
  }).catch(() => {});
}
start();
