import * as db from './db.js';
import * as sync from './sync.js';
import * as C from './calc.js';
import { OBRA_INICIAL } from './seed.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => (v === '' || v === null || v === undefined ? undefined : +String(v).replace(/[$,\s]/g, ''));

let obra, records = [], settings, corte = C.hoy();
const main = () => $('#main');

// ---------- Datos ----------
async function cargar() {
  settings = await db.kvGet('settings', { obraId: OBRA_INICIAL.id, autor: '' });
  obra = await db.kvGet('obra:' + settings.obraId);
  if (!obra) { obra = { ...OBRA_INICIAL, updatedAt: 0 }; await db.kvSet('obra:' + obra.id, obra); }
  records = (await db.all('records')).filter(r => r.obraId === obra.id);
}

async function guardarObra(o) {
  o.updatedAt = Date.now();
  obra = o;
  await db.kvSet('obra:' + o.id, o);
  await db.enqueue('config', o.id, o.id);
  pedirSync();
}

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
function pedirSync() { clearTimeout(syncTimer); syncTimer = setTimeout(async () => { const n = await sync.syncNow(obra.id); if (n) { await cargar(); render(); } }, 500); }

// ---------- Barra de estado ----------
function pintarEstado(s = sync.state) {
  const el = $('#estado');
  const online = navigator.onLine;
  let txt, cls;
  if (!online) { txt = `Sin señal · ${s.pending ? s.pending + ' por subir' : 'todo guardado en el teléfono'}`; cls = 'off'; }
  else if (!s.configured) { txt = `Modo local · ${s.pending} por subir (configura la nube en Ajustes)`; cls = 'warn'; }
  else if (!s.signedIn || s.needsLogin) { txt = `Inicia sesión para subir · ${s.pending} pendientes`; cls = 'warn'; }
  else if (s.syncing) { txt = 'Sincronizando…'; cls = 'busy'; }
  else if (s.error) { txt = `Error al subir: ${s.error}`; cls = 'err'; }
  else if (s.pending) { txt = `${s.pending} por subir`; cls = 'busy'; }
  else { txt = s.lastSync ? `Sincronizado · ${new Date(s.lastSync).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Listo'; cls = 'ok'; }
  el.className = 'estado ' + cls;
  el.textContent = txt;
}

// ---------- Vistas ----------
const RUTAS = { tablero: vTablero, capturar: vCapturar, historial: vHistorial, fotos: vFotos, obra: vObra, ajustes: vAjustes };

function render() {
  const [ruta, arg] = (location.hash.replace(/^#\/?/, '') || 'tablero').split('/');
  const fn = RUTAS[ruta] || vTablero;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('activo', a.getAttribute('href') === '#/' + (RUTAS[ruta] ? ruta : 'tablero')));
  fn(arg);
  pintarEstado();
}

function barra(pct, color = 'var(--verde)') {
  const p = Math.max(0, Math.min(1, pct || 0)) * 100;
  return `<div class="barra"><span style="width:${p}%;background:${color}"></span></div>`;
}

function kpi(t, v, a, b, pct) {
  return `<div class="kpi"><div class="kpi-t">${t}</div><div class="kpi-v">${v}</div>${pct !== undefined ? barra(pct) : ''}<div class="kpi-a">${a || ''}</div><div class="kpi-b">${b || ''}</div></div>`;
}

function vTablero() {
  const R = C.resumen(obra, records, corte);
  const est = R.programa.metodo === 'mensual' ? ' (est.)' : '';
  const t = R.tuberia.total;
  const dev = R.desviacion;
  main().innerHTML = `
  <section class="cab">
    <h1>${esc(obra.nombre)}</h1>
    <p class="sub">${esc(obra.localidad)}</p>
    <label class="corte">Avance al <input type="date" id="corte" value="${corte}"></label>
  </section>
  <div class="kpis">
    ${kpi('Plazo transcurrido', C.fmtPct(R.plazo.pct), `Día ${R.plazo.dia} de ${R.plazo.duracion}`, `${R.plazo.restantes} días restantes`, R.plazo.pct)}
    ${kpi('Tubería instalada', C.fmtPct(t.pct), `${C.fmtM(t.instalado)} de ${C.fmtM(t.longitud)}`, R.tuberia.tramos.map(x => x.diametro).join(' y '), t.pct)}
    ${kpi('Programa a la fecha' + est, C.fmtPct(R.programa.pct), `${C.fmtMoney(R.programa.importe)} de ${C.fmtMoney(R.programa.total)}`, 'Importe programado acumulado', R.programa.pct)}
    ${kpi('Avance físico real', C.fmtPct(R.fisico), dev === null ? 'Captura el avance por grupo' : `<b class="${dev < 0 ? 'neg' : 'pos'}">${dev >= 0 ? '+' : ''}${(dev * 100).toFixed(1)} pts</b> vs programa`, 'Ponderado por importe', R.fisico ?? undefined)}
    ${kpi('Avance financiero real', C.fmtPct(R.financiero?.pct), R.financiero ? C.fmtMoney(R.financiero.importe) : 'Sin captura', R.financiero ? 'Al ' + C.fechaCorta(R.financiero.fecha) : '', R.financiero?.pct)}
    ${kpi('Personal en obra', R.personal ? esc(R.personal.valor) : '—', R.personal ? 'Al ' + C.fechaCorta(R.personal.fecha) : 'Sin captura')}
    ${kpi('Atrasos', R.atrasos ? esc(R.atrasos.valor) + ' días' : '—', R.atrasos ? 'Al ' + C.fechaCorta(R.atrasos.fecha) : 'Sin captura')}
  </div>
  ${R.programa.metodo === 'mensual' ? '<p class="nota">Programa estimado con los montos mensuales. Importa las 36 partidas del AE10 en <a href="#/obra">Obra</a> para el cálculo exacto por concepto.</p>' : ''}

  <h2>Tubería</h2>
  <div class="tarjeta">
  ${R.tuberia.tramos.map(tr => `
    <div class="tramo">
      <div class="fila"><b>${esc(tr.frente)} · ${esc(tr.diametro)}</b><span class="pct">${C.fmtPct(tr.pct)}</span></div>
      ${barra(tr.pct)}
      <div class="peq">${C.fmtM(tr.instalado)} de ${C.fmtM(tr.longitud)} · por instalar ${C.fmtM(tr.restante)} ${tr.excede ? '<b class="neg">· excede la longitud total</b>' : ''}</div>
    </div>`).join('')}
  ${R.tuberia.frentes.map(f => `<div class="fila total"><b>Total ${esc(f.frente)}</b><span>${C.fmtM(f.instalado)} de ${C.fmtM(f.longitud)} · ${C.fmtPct(f.pct)}</span></div>`).join('')}
  </div>

  <h2>Programa de erogaciones</h2>
  <div class="tarjeta"><table><thead><tr><th>Periodo</th><th class="r">Importe</th><th class="r">% periodo</th><th class="r">% acum.</th></tr></thead><tbody>
  ${R.periodos.map(p => `<tr><td>${p.nombre}</td><td class="r">${C.fmtMoney(p.monto)}</td><td class="r">${C.fmtPct(p.pct)}</td><td class="r">${C.fmtPct(p.pctAcum)}</td></tr>`).join('')}
  </tbody></table></div>

  <h2>Avance por grupo</h2>
  <div class="tarjeta"><table><thead><tr><th>Grupo</th><th class="r">Importe</th><th class="r">%</th><th class="r">Real</th></tr></thead><tbody>
  ${R.grupos.filas.map(g => `<tr><td>${esc(g.nombre)}</td><td class="r">${C.fmtMoney(g.importe)}</td><td class="r">${C.fmtPct(g.peso)}</td><td class="r">${C.fmtPct(g.avance)}</td></tr>`).join('')}
  <tr class="tot"><td>Total</td><td class="r">${C.fmtMoney(R.grupos.total)}</td><td class="r">100.0%</td><td class="r">${C.fmtPct(R.fisico)}</td></tr>
  </tbody></table></div>

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
      await generarPPTX(obra, R, id => sync.getPhoto(obra.id, id));
    } catch (err) { alert(err.message); }
    e.target.disabled = false; e.target.textContent = 'Descargar reporte PPTX';
  };
}

// --- Captura ---
async function comprimir(file, max = 1600, q = 0.72) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(r => cv.toBlob(b => r(b || file), 'image/jpeg', q));
}

async function vCapturar(id) {
  let rec;
  if (id) rec = await db.get('records', id);
  if (!rec) {
    rec = await db.kvGet('draft:' + obra.id);
    if (!rec || id) rec = { id: uid(), obraId: obra.id, fecha: C.hoy(), autor: settings.autor, tuberia: {}, avanceGrupos: {}, fotos: [], creado: Date.now() };
  }
  const esBorrador = !(await db.get('records', rec.id));
  const ultimoGrupo = g => { const rs = records.filter(r => !r.borrado && r.avanceGrupos?.[g] !== undefined && r.id !== rec.id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); return rs[0]?.avanceGrupos[g]; };
  const R = C.tuberia(obra, records.filter(r => r.id !== rec.id), C.hoy());
  const urls = [];
  const thumb = async f => { const b = await sync.getPhoto(obra.id, f.id); if (!b) return ''; const u = URL.createObjectURL(b); urls.push(u); return u; };
  const thumbs = await Promise.all(rec.fotos.map(thumb));
  const frentes = [...new Set(obra.tramos.map(t => t.frente))];

  main().innerHTML = `
  <h1>${esBorrador ? 'Nueva captura' : 'Editar captura'}</h1>
  <form id="f" class="form">
    <div class="dos">
      <label>Fecha<input type="date" name="fecha" value="${esc(rec.fecha)}" required></label>
      <label>Capturista<input name="autor" value="${esc(rec.autor || settings.autor)}" placeholder="Tu nombre" required></label>
    </div>
    <fieldset><legend>Tubería instalada en este periodo (metros nuevos)</legend>
      ${obra.tramos.map(t => { const r = R.tramos.find(x => x.id === t.id); return `
        <label>${esc(t.frente)} · ${esc(t.diametro)} <span class="peq">(llevan ${C.fmtM(r.instalado)} de ${C.fmtM(t.longitud)})</span>
        <input name="tub_${t.id}" inputmode="decimal" placeholder="0.00" value="${rec.tuberia?.[t.id] ?? ''}"></label>`; }).join('')}
    </fieldset>
    <fieldset><legend>Obra</legend>
      <div class="dos">
        <label>Personal en obra<input name="personal" inputmode="numeric" value="${rec.personal ?? ''}"></label>
        <label>Días de atraso<input name="atrasosDias" inputmode="numeric" value="${rec.atrasosDias ?? ''}"></label>
      </div>
      <label>Importe ejecutado acumulado ($) <span class="peq">opcional, para avance financiero</span><input name="importeEjecutado" inputmode="decimal" value="${rec.importeEjecutado ?? ''}"></label>
    </fieldset>
    <fieldset><legend>Avance real acumulado por grupo (%)</legend>
      ${obra.grupos.map(g => { const u = ultimoGrupo(g.id); return `<label>${esc(g.nombre)}<input name="grp_${g.id}" inputmode="decimal" placeholder="${u !== undefined ? 'último: ' + u + '%' : '0–100'}" value="${rec.avanceGrupos?.[g.id] ?? ''}"></label>`; }).join('')}
    </fieldset>
    <fieldset><legend>Observaciones</legend>
      <label>Actividades de la próxima semana<textarea name="actividades" rows="3">${esc(rec.actividades)}</textarea></label>
      <label>Atrasos y problemática<textarea name="problematica" rows="3">${esc(rec.problematica)}</textarea></label>
      <label>Requerimientos y acuerdos<textarea name="requerimientos" rows="3">${esc(rec.requerimientos)}</textarea></label>
    </fieldset>
    <fieldset><legend>Fotografías</legend>
      <div class="fotos-ed">
        ${rec.fotos.map((f, i) => `<div class="foto-ed" data-i="${i}">
          ${thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : '<div class="sinfoto">Sin descargar</div>'}
          <select name="ff_${i}">${frentes.map(fr => `<option ${f.frente === fr ? 'selected' : ''}>${esc(fr)}</option>`).join('')}<option ${!frentes.includes(f.frente) ? 'selected' : ''} value="">Otro</option></select>
          <input name="fc_${i}" placeholder="Actividad" value="${esc(f.caption)}">
          <button type="button" class="quitar" data-i="${i}">Quitar</button></div>`).join('')}
      </div>
      <label class="btn sec">Tomar / agregar fotos<input type="file" id="files" accept="image/*" multiple hidden></label>
    </fieldset>
    <button class="btn grande" type="submit">Guardar</button>
    ${esBorrador ? '<button type="button" class="btn sec" id="descartar">Descartar borrador</button>' : '<button type="button" class="btn peligro" id="borrar">Eliminar captura</button>'}
    <p class="peq">Se guarda en este teléfono aunque no haya señal y se sube solo cuando regrese.</p>
  </form>`;

  const form = $('#f');
  const leer = () => {
    const fd = new FormData(form);
    const o = { ...rec, fecha: fd.get('fecha'), autor: fd.get('autor').trim(), tuberia: {}, avanceGrupos: {} };
    for (const t of obra.tramos) { const v = num(fd.get('tub_' + t.id)); if (v !== undefined && !isNaN(v)) o.tuberia[t.id] = v; }
    for (const g of obra.grupos) { const v = num(fd.get('grp_' + g.id)); if (v !== undefined && !isNaN(v)) o.avanceGrupos[g.id] = Math.max(0, Math.min(100, v)); }
    for (const k of ['personal', 'atrasosDias', 'importeEjecutado']) { const v = num(fd.get(k)); if (v !== undefined && !isNaN(v)) o[k] = v; else delete o[k]; }
    for (const k of ['actividades', 'problematica', 'requerimientos']) o[k] = fd.get(k) || '';
    o.fotos = rec.fotos.map((f, i) => ({ ...f, frente: fd.get('ff_' + i) ?? f.frente, caption: fd.get('fc_' + i) ?? f.caption }));
    return o;
  };
  const guardarBorrador = () => { if (esBorrador) { rec = leer(); db.kvSet('draft:' + obra.id, rec); } };
  form.oninput = guardarBorrador;

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
    urls.forEach(URL.revokeObjectURL);
    vCapturar(esBorrador ? undefined : rec.id);
  };
  form.querySelectorAll('.quitar').forEach(b => b.onclick = async () => {
    rec = leer();
    const [f] = rec.fotos.splice(+b.dataset.i, 1);
    const ph = await db.get('photos', f.id);
    if (ph && !ph.synced) { await db.del('photos', f.id); await db.del('outbox', 'photo:' + f.id); }
    if (esBorrador) await db.kvSet('draft:' + obra.id, rec); else await guardarRecord(rec);
    vCapturar(esBorrador ? undefined : rec.id);
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const o = leer();
    if (o.autor && o.autor !== settings.autor) { settings.autor = o.autor; await db.kvSet('settings', settings); }
    await guardarRecord(o);
    await db.del('kv', 'draft:' + obra.id);
    toast('Captura guardada');
    location.hash = '#/historial';
  };
  $('#descartar')?.addEventListener('click', async () => {
    if (!confirm('¿Descartar este borrador?')) return;
    for (const f of rec.fotos) { await db.del('photos', f.id); }
    await db.del('kv', 'draft:' + obra.id);
    vCapturar();
  });
  $('#borrar')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta captura? Se quitará también para los demás.')) return;
    await guardarRecord({ ...rec, borrado: true });
    location.hash = '#/historial';
  });
}

function vHistorial() {
  const rs = records.filter(r => !r.borrado).sort((a, b) => (a.fecha === b.fecha ? (b.creado || 0) - (a.creado || 0) : a.fecha < b.fecha ? 1 : -1));
  main().innerHTML = `<h1>Capturas</h1>
  ${rs.length ? rs.map(r => {
    const m = Object.values(r.tuberia || {}).reduce((s, v) => s + (+v || 0), 0);
    return `<a class="tarjeta item" href="#/capturar/${r.id}">
      <div class="fila"><b>${C.fechaCorta(r.fecha)} · ${esc(r.autor || 'Sin nombre')}</b><span class="chip ${r._sync === 'ok' ? 'ok' : 'pend'}">${r._sync === 'ok' ? 'En la nube' : 'Por subir'}</span></div>
      <div class="peq">${m ? C.fmtM(m) + ' de tubería · ' : ''}${r.personal !== undefined ? r.personal + ' personas · ' : ''}${(r.fotos || []).length} fotos</div></a>`;
  }).join('') : '<p class="peq">Aún no hay capturas.</p>'}
  <a class="btn grande" href="#/capturar">+ Nueva captura</a>`;
}

async function vFotos() {
  const fs = records.filter(r => !r.borrado).flatMap(r => (r.fotos || []).map(f => ({ ...f, fecha: f.fecha || r.fecha, autor: r.autor }))).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  main().innerHTML = `<h1>Fotografías</h1><div class="galeria">${fs.map(f => `<figure data-id="${f.id}"><div class="ph"></div><figcaption>${esc(f.frente)} ${f.caption ? '· ' + esc(f.caption) : ''}<br><span class="peq">${C.fechaCorta(f.fecha)} · ${esc(f.autor || '')}</span></figcaption></figure>`).join('') || '<p class="peq">Sin fotos.</p>'}</div>`;
  for (const fig of main().querySelectorAll('figure')) {
    sync.getPhoto(obra.id, fig.dataset.id).then(b => {
      const ph = fig.querySelector('.ph');
      if (b) { const u = URL.createObjectURL(b); ph.innerHTML = `<img src="${u}" alt="">`; ph.onclick = () => window.open(u); }
      else ph.textContent = navigator.onLine ? 'No disponible' : 'Se descarga con señal';
    });
  }
}

function vObra() {
  const o = obra;
  main().innerHTML = `<h1>Datos de la obra</h1>
  <form id="fo" class="form">
    <fieldset><legend>Generales</legend>
      <label>Nombre<input name="nombre" value="${esc(o.nombre)}"></label>
      <label>Localidad<input name="localidad" value="${esc(o.localidad)}"></label>
      <label>Cliente<input name="cliente" value="${esc(o.cliente)}"></label>
      <div class="dos"><label>Concurso No.<input name="concurso" value="${esc(o.concurso)}"></label><label>Fecha concurso<input type="date" name="fechaConcurso" value="${esc(o.fechaConcurso)}"></label></div>
      <div class="dos"><label>Inicio de obra<input type="date" name="inicio" value="${esc(o.inicio)}"></label><label>Fin de obra<input type="date" name="fin" value="${esc(o.fin)}"></label></div>
      <label>Monto total del programa ($)<input name="montoTotal" inputmode="decimal" value="${o.montoTotal}"></label>
    </fieldset>
    <fieldset><legend>Tramos de tubería</legend>
      <p class="peq">Una línea por tramo: Frente | Diámetro | Longitud total (m) | Nota de zanja | Metros instalados iniciales | Fecha inicial</p>
      <textarea name="tramos" rows="4">${esc(o.tramos.map(t => [t.frente, t.diametro, t.longitud, t.zanja || '', t.inicial?.metros ?? '', t.inicial?.fecha ?? ''].join(' | ')).join('\n'))}</textarea>
    </fieldset>
    <fieldset><legend>Grupos de conceptos</legend>
      <p class="peq">Una línea por grupo: Nombre | Importe</p>
      <textarea name="grupos" rows="6">${esc(o.grupos.map(g => `${g.nombre} | ${g.importe}`).join('\n'))}</textarea>
    </fieldset>
    <fieldset><legend>Programa mensual (si no hay partidas)</legend>
      <p class="peq">Una línea por mes: AAAA-MM | Monto</p>
      <textarea name="mensual" rows="3">${esc(o.programaMensual.map(m => `${m.mes} | ${m.monto}`).join('\n'))}</textarea>
    </fieldset>
    <fieldset><legend>Partidas del AE10 (${o.conceptos.length} cargadas)</legend>
      <p class="peq">Copia desde Excel las columnas <b>Clave, Descripción, Grupo, Importe, Fecha inicio, Fecha fin</b> y pégalas aquí. Fechas como dd/mm/aaaa o aaaa-mm-dd. Déjalo vacío para usar el programa mensual.</p>
      <textarea name="conceptos" rows="6" placeholder="Pega aquí desde Excel">${esc(o.conceptos.map(k => [k.clave, k.descripcion, k.grupo, k.importe, C.fechaCorta(k.inicio), C.fechaCorta(k.fin)].join('\t')).join('\n'))}</textarea>
    </fieldset>
    <p id="errObra" class="neg"></p>
    <button class="btn grande">Guardar datos de la obra</button>
  </form>`;
  const fecha = s => { s = String(s).trim(); const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; throw new Error('Fecha no válida: ' + s); };
  const lineas = t => t.split('\n').map(l => l.trim()).filter(Boolean);
  $('#fo').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const n = { ...o };
      for (const k of ['nombre', 'localidad', 'cliente', 'concurso', 'fechaConcurso', 'inicio', 'fin']) n[k] = fd.get(k);
      n.montoTotal = num(fd.get('montoTotal'));
      n.tramos = lineas(fd.get('tramos')).map((l, i) => {
        const [frente, diametro, lon, zanja, mi, fi] = l.split('|').map(x => x.trim());
        const prev = o.tramos[i];
        const id = prev && prev.frente === frente && prev.diametro === diametro ? prev.id : (frente + '-' + diametro).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return { id, frente, diametro, longitud: num(lon), zanja, ...(mi ? { inicial: { metros: num(mi), fecha: fi ? fecha(fi) : n.inicio } } : {}) };
      });
      n.grupos = lineas(fd.get('grupos')).map((l, i) => {
        const [nombre, imp] = l.split('|').map(x => x.trim());
        const prev = o.grupos.find(g => g.nombre === nombre) || o.grupos[i];
        return { id: prev?.nombre === nombre ? prev.id : nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'g' + i, nombre, importe: num(imp) };
      });
      n.programaMensual = lineas(fd.get('mensual')).map(l => { const [mes, m] = l.split('|').map(x => x.trim()); return { mes, monto: num(m) }; });
      n.conceptos = lineas(fd.get('conceptos')).map(l => {
        const c = l.split('\t');
        if (c.length < 6) throw new Error('Cada partida necesita 6 columnas separadas por tabulador (pegar desde Excel): ' + l.slice(0, 40));
        return { clave: c[0], descripcion: c[1], grupo: c[2], importe: num(c[3]), inicio: fecha(c[4]), fin: fecha(c[5]) };
      });
      if ([n.montoTotal, ...n.tramos.map(t => t.longitud), ...n.grupos.map(g => g.importe)].some(v => v === undefined || isNaN(v))) throw new Error('Hay un número no válido.');
      await guardarObra(n);
      toast('Datos de la obra guardados');
      location.hash = '#/tablero';
    } catch (err) { $('#errObra').textContent = err.message; }
  };
}

async function vAjustes() {
  const cfg = await sync.cloudCfg();
  const s = sync.state;
  const persist = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  main().innerHTML = `<h1>Ajustes</h1>
  <form id="fa" class="form">
    <fieldset><legend>Capturista</legend><label>Tu nombre<input name="autor" value="${esc(settings.autor)}"></label></fieldset>
    <fieldset><legend>Nube (OneDrive)</legend>
      <p>${s.configured ? (s.signedIn ? `Sesión: <b>${esc(s.user)}</b>` : 'Sin sesión') : 'No configurado: la app trabaja solo en este dispositivo.'}</p>
      <label>Client ID de la app en Microsoft<input name="clientId" value="${esc(cfg.clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <label>Link de la carpeta compartida <span class="peq">(vacío = carpeta REMA-Reportes predeterminada)</span><input name="shareUrl" value="${esc(cfg.shareUrl)}" placeholder="https://1drv.ms/f/..."></label>
      <button class="btn sec" type="submit">Guardar ajustes</button>
      ${s.configured ? (s.signedIn && !s.needsLogin ? '<button class="btn sec" type="button" id="sincro">Sincronizar ahora</button><button class="btn sec" type="button" id="salir">Cerrar sesión</button>' : '<button class="btn" type="button" id="entrar">Iniciar sesión con Microsoft</button>') : ''}
    </fieldset>
    <fieldset><legend>Respaldo</legend>
      <p class="peq">Almacenamiento protegido: ${persist ? 'sí' : 'no (el sistema podría borrarlo si falta espacio)'} · ${s.pending} cambios por subir.</p>
      <button class="btn sec" type="button" id="exportar">Exportar respaldo (JSON)</button>
      <label class="btn sec">Importar respaldo<input type="file" id="importar" accept="application/json" hidden></label>
    </fieldset>
    <p class="peq">Versión ${window.APP_VERSION}</p>
  </form>`;
  $('#fa').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    settings.autor = fd.get('autor').trim();
    await db.kvSet('settings', settings);
    const n = { clientId: fd.get('clientId').trim(), shareUrl: fd.get('shareUrl').trim() };
    const cambio = n.clientId !== cfg.clientId || n.shareUrl !== cfg.shareUrl;
    await db.kvSet('cloud', n);
    if (cambio) { await db.kvSet('root', null); location.reload(); } else toast('Guardado');
  };
  $('#entrar')?.addEventListener('click', () => sync.login().catch(err => alert(err.message)));
  $('#salir')?.addEventListener('click', () => { if (sync.state.pending && !confirm(`Hay ${sync.state.pending} cambios sin subir. Se quedan en el teléfono. ¿Cerrar sesión?`)) return; sync.logout(); });
  $('#sincro')?.addEventListener('click', () => pedirSync());
  $('#exportar').onclick = async () => {
    const data = { app: 'rema-reportes', fecha: new Date().toISOString(), obra, records: records.map(r => ({ ...r })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `respaldo-${obra.id}-${C.hoy()}.json`; a.click();
  };
  $('#importar').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'rema-reportes') throw new Error('No es un respaldo de esta app.');
      if (!confirm(`Importar ${data.records.length} capturas de "${data.obra.nombre}"? Las capturas con el mismo identificador se reemplazan.`)) return;
      await guardarObra(data.obra);
      settings.obraId = data.obra.id; await db.kvSet('settings', settings);
      for (const r of data.records) await guardarRecord({ ...r, obraId: data.obra.id });
      toast('Respaldo importado'); location.hash = '#/tablero';
    } catch (err) { alert(err.message); }
  };
}

function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('ver');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('ver'), 2200);
}

// ---------- Arranque ----------
async function start() {
  await cargar();
  sync.onChange(pintarEstado);
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { pintarEstado(); pedirSync(); });
  window.addEventListener('offline', () => pintarEstado());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirSync(); });
  setInterval(() => { if (navigator.onLine) pedirSync(); }, 60000);
  render();
  await sync.init();
  pintarEstado();
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
