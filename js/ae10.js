// Lector de programas de obra (AE10) y presupuestos (AE12/catálogos) exportados de Excel.
// No depende de un formato fijo: ubica las columnas por su encabezado, arma la jerarquía
// de grupos con los renglones de título y sus "TOTAL ...", e ignora los renglones de
// página (Monto esta hoja, Acumulado, Apoderado Legal, Barra=...).
// parsearHoja() recibe la hoja como arreglo de renglones (arreglo de celdas) y es pura,
// para poder probarla fuera del navegador.

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const esNum = v => typeof v === 'number' && isFinite(v) || (typeof v === 'string' && /^-?\d+(\.\d+)?([eE]-?\d+)?$/.test(v.trim()));
const aNum = v => (typeof v === 'number' ? v : esNum(v) ? parseFloat(v) : null);
const vacio = v => v === null || v === undefined || String(v).trim() === '';

// Fecha de Excel (número de serie) o Date o texto dd/mm/aaaa → 'AAAA-MM-DD'.
export function aFecha(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const n = aNum(v);
  if (n !== null && n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? ''))) return String(v).slice(0, 10);
  // Encabezado de mes en texto: "Dic-2026", "ENE 2027", "Febrero/27" → primer día del mes.
  const mm = norm(v).match(/^([A-Z]{3,10})\.?[\s\-\/]*(\d{4}|\d{2})$/);
  if (mm) {
    const mes = MESES.findIndex(p => mm[1].startsWith(p));
    if (mes >= 0 && (mm[1].length === 3 || MESES_L[mes].startsWith(mm[1]))) {
      const anio = mm[2].length === 2 ? 2000 + +mm[2] : +mm[2];
      return `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
    }
  }
  return null;
}
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const MESES_L = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

const COLUMNAS = {
  clave: t => /^(CODIGO|CLAVE|CVE\.?)$/.test(t),
  descripcion: t => /^(DESCRIPCION|CONCEPTO|DESCRIPCION DEL CONCEPTO)/.test(t),
  unidad: t => /^(UNIDAD|UNID\.?|UND\.?|U\.?)$/.test(t),
  cantidad: t => /^(CANTIDAD|VOLUMEN|CANT\.?)$/.test(t),
  precio: t => /^(PRECIO( UNITARIO)?|P\.? ?U\.?|P\. UNITARIO|PRECIO U\.?)$/.test(t),
  importe: t => /^(IMPORTE|IMPORTE TOTAL|TOTAL)$/.test(t),
  inicio: t => /^(INICIO|FECHA INICIO|F\. INICIO)$/.test(t),
  fin: t => /^(FIN|TERMINO|FECHA FIN|F\. FIN|FECHA TERMINO)$/.test(t),
};

function buscarEncabezado(rows) {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = rows[i] || [];
    const cols = {};
    r.forEach((c, j) => {
      const t = norm(c);
      for (const [k, f] of Object.entries(COLUMNAS)) if (cols[k] === undefined && t && f(t)) cols[k] = j;
    });
    const sinImporte = cols.importe === undefined && cols.cantidad !== undefined && cols.precio !== undefined;
    if (cols.descripcion !== undefined && (cols.importe !== undefined || sinImporte) && Object.keys(cols).length >= 4) {
      // Columnas de periodo: fechas (o meses en texto) en el encabezado, a la derecha de las columnas fijas.
      const fijas = Math.max(...['cantidad', 'precio', 'inicio', 'fin'].map(k => cols[k] ?? -1));
      const periodos = [];
      r.forEach((c, j) => { if (j > fijas && j !== cols.importe && aFecha(c)) periodos.push({ col: j, desde: aFecha(c) }); });
      // Un "Total" a la derecha de los meses es la suma del renglón (cantidad o importe según el
      // renglón), no el importe de la partida: entonces el importe es cantidad × precio.
      if (cols.importe !== undefined && periodos.length && cols.importe > periodos[0].col && cols.cantidad !== undefined && cols.precio !== undefined) delete cols.importe;
      return { fila: i, cols, periodos };
    }
  }
  return null;
}

// Datos generales que vienen arriba del encabezado (Cliente:, Obra:, Concurso, Inicio obra:, …).
function leerDatosGenerales(rows, hasta) {
  const etiquetas = {
    cliente: /^CLIENTE:?$/, concurso: /^CONCURSO( NO\.?)?:?$/, nombre: /^OBRA:?$/, lugar: /^LUGAR:?$/, ciudad: /^CIUDAD:?$/,
    fechaConcurso: /^FECHA:?$/, inicio: /^INICIO( DE)? OBRA:?$/, fin: /^FIN( DE)? OBRA:?$/, duracion: /^DURACION:?$/,
  };
  const out = {};
  for (let i = 0; i < hasta; i++) {
    const r = rows[i] || [];
    for (let j = 0; j < r.length; j++) {
      const t = norm(r[j]);
      for (const [k, re] of Object.entries(etiquetas)) {
        if (out[k] === undefined && re.test(t)) {
          let v; for (let x = j + 1; x < r.length; x++) if (!vacio(r[x])) { v = r[x]; break; }
          if (v !== undefined) out[k] = v;
        }
      }
    }
  }
  const g = {};
  if (out.cliente) g.cliente = String(out.cliente).trim();
  if (out.concurso) g.concurso = String(out.concurso).trim();
  if (out.nombre) g.nombre = String(out.nombre).trim();
  const lugar = [out.lugar, out.ciudad].filter(Boolean).map(s => String(s).trim());
  if (lugar.length) g.localidad = [...new Set(lugar)].join(', ');
  if (aFecha(out.fechaConcurso)) g.fechaConcurso = aFecha(out.fechaConcurso);
  if (aFecha(out.inicio)) g.inicio = aFecha(out.inicio);
  if (aFecha(out.fin)) g.fin = aFecha(out.fin);
  return g;
}

const RUIDO = /^(?:(?:TOTAL|ACUMULADO|PORCENTAJE|MONTO ESTA HOJA|ACUMULADO ANTERIOR|APODERADO|SUBTOTAL|IVA|IMPORTE CON LETRA)(?![A-Z])|BARRA=|\(\*)/;
// Totales de toda la obra: no cierran ningún grupo.
const TOTAL_GENERAL = /^TOTAL (DEL? )?(PRESUPUESTO|GENERAL|OBRA|LA OBRA|CATALOGO)\b/;

// Identificador estable: la misma partida (clave + ubicación) conserva su id al volver a importar.
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const slug = s => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export function parsearHoja(rows) {
  const enc = buscarEncabezado(rows);
  if (!enc) throw new Error('No encontré el encabezado de partidas (columnas como Código, Descripción, Unidad, Cantidad, Precio, Importe).');
  const { cols, periodos } = enc;
  const generales = leerDatosGenerales(rows, enc.fila);
  const avisos = [];
  const conceptos = [];
  const pila = []; // grupos abiertos
  let hayTotales = false;
  let ultimo = null; // última partida, para leer sus renglones de periodo
  const idsUsados = new Set();
  const texto = (r, j) => (j === undefined ? '' : String((r || [])[j] ?? ''));
  const conNumeros = r => periodos.some(p => esNum((r || [])[p.col]));

  function continuarDescripcion(k, d, i) {
    if (k.descripcion.length < 1200) k.descripcion = (k.descripcion + ' ' + d.replace(/\s+/g, ' ').trim()).trim();
    k._ultFila = i;
  }
  function esTitulo(i) {
    const k = ultimo;
    const terminada = /\.\s*$/.test(k.descripcion);
    let hueco = false;
    for (let x = i - 1; x > (k._ultFila ?? i); x--) if (vacio(texto(rows[x], cols.descripcion))) { hueco = true; break; }
    if (!terminada && !hueco) return false;
    for (let x = i, n = 0; x < rows.length && n < 8; x++) {
      const r = rows[x] || [];
      if (!vacio(texto(r, cols.clave)) || !vacio(texto(r, cols.unidad))) return true;
      const d = texto(r, cols.descripcion);
      if (vacio(d)) continue;
      if (/\.\s*$/.test(d) || conNumeros(r) || /^TOTAL /.test(norm(d))) return false;
      n++;
    }
    return false;
  }

  for (let i = enc.fila + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const celdaTexto = j => (j === undefined ? '' : String(r[j] ?? ''));
    const desc = celdaTexto(cols.descripcion);
    const clave = celdaTexto(cols.clave).trim();
    const textos = r.filter(c => typeof c === 'string' && c.trim()).map(norm);
    const descN = norm(desc);

    // Renglones de total: cierran grupos.
    const mTotal = descN.match(/^TOTAL (.+)$/) || (cols.clave !== undefined && norm(celdaTexto(cols.clave)).match(/^TOTAL (.+)$/));
    if (mTotal) {
      if (TOTAL_GENERAL.test(mTotal[0])) { ultimo = null; continue; }
      hayTotales = true;
      const nombre = mTotal[1];
      const k = pila.map(g => norm(g)).findLastIndex(g => g.startsWith(nombre) || nombre.startsWith(g));
      if (k >= 0) pila.length = k;
      ultimo = null;
      continue;
    }
    if (RUIDO.test(descN) || RUIDO.test(norm(clave))) continue;

    const unidad = celdaTexto(cols.unidad).trim();
    const importe = cols.importe !== undefined ? aNum(r[cols.importe])
      : (aNum(r[cols.cantidad]) !== null && aNum(r[cols.precio]) !== null && !vacio(clave + unidad) ? aNum(r[cols.cantidad]) * aNum(r[cols.precio]) : null);
    const esPartida = !vacio(desc) && importe !== null && importe > 0 && (unidad || aNum(r[cols.cantidad]));
    // Renglones de página ("Monto esta hoja", "Acumulado", "Barra=…") en otras columnas.
    if (!esPartida && textos.some(t => RUIDO.test(t)) && !(ultimo && vacio(desc) && vacio(clave))) continue;

    if (esPartida) {
      const cantidad = aNum(r[cols.cantidad]);
      let precio = aNum(r[cols.precio]);
      if (precio === null && cantidad) precio = importe / cantidad;
      const ruta = pila.slice();
      let id = (slug(clave) || 'p') + '-' + hash(ruta.join('/') + '|' + clave);
      if (idsUsados.has(id)) { let n = 2; while (idsUsados.has(id + '-' + n)) n++; id += '-' + n; }
      idsUsados.add(id);
      const k = {
        id, clave, descripcion: desc.replace(/\s+/g, ' ').trim(), unidad,
        cantidad: cantidad ?? 0, precio: precio ?? 0, importe: Math.round(importe * 100) / 100, ruta,
      };
      const ini = cols.inicio !== undefined ? aFecha(r[cols.inicio]) : null;
      const fin = cols.fin !== undefined ? aFecha(r[cols.fin]) : null;
      if (ini && fin) { k.inicio = ini; k.fin = fin; }
      // Valores de periodo en el mismo renglón (pueden ser %, cantidades o importes).
      k._filasPeriodo = periodos.length ? [periodos.map(p => aNum(r[p.col]) ?? 0)] : [];
      k._ultFila = i;
      conceptos.push(k);
      ultimo = k;
      continue;
    }

    // Renglón solo con números en columnas de periodo: pertenece a la última partida.
    // (En algunos programas trae además la continuación de la descripción.)
    if (ultimo && vacio(clave) && !unidad && periodos.length && periodos.some(p => esNum(r[p.col]))) {
      ultimo._filasPeriodo.push(periodos.map(p => aNum(r[p.col]) ?? 0));
      if (!vacio(desc)) continuarDescripcion(ultimo, desc, i);
      continue;
    }

    // Descripción en varios renglones: después de una partida, el texto sigue siendo suyo,
    // salvo que sea un título de grupo (va justo antes de una partida, la descripción anterior
    // ya había terminado en punto y ningún renglón del título termina en punto).
    if (ultimo && !vacio(desc) && vacio(clave) && !unidad && !(importe > 0) && !/^\s|^[a-zà-ü]/.test(desc)) {
      if (!esTitulo(i)) { continuarDescripcion(ultimo, desc, i); continue; }
      ultimo = null;
    }

    // Título de grupo. Se descartan restos de descripciones cortadas (empiezan con espacio o minúscula).
    if (!vacio(desc) && vacio(clave) && !unidad && !(importe > 0)) {
      if (/^\s/.test(desc) || /^[a-zà-ü]/.test(desc.trim())) continue;
      const nombre = desc.replace(/\s+/g, ' ').trim();
      // Sin renglones TOTAL no se puede saber la profundidad: se tratan como hermanos.
      if (!hayTotales && pila.length && !rows.slice(i).some(x => (x || []).some(c => /^TOTAL /.test(norm(c)) && !TOTAL_GENERAL.test(norm(c))))) pila.length = 0;
      pila.push(nombre);
      ultimo = null;
    }
  }

  // Reparto por periodo: se elige el renglón cuya suma coincide con el importe (o la cantidad).
  for (const k of conceptos) {
    const filas = k._filasPeriodo;
    delete k._filasPeriodo;
    delete k._ultFila;
    if (!filas.length) continue;
    const suma = f => f.reduce((s, v) => s + v, 0);
    const cerca = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.002);
    const imp = filas.find(f => cerca(suma(f), k.importe));
    const cant = filas.find(f => f !== imp && k.cantidad && cerca(suma(f), k.cantidad));
    if (imp) {
      k.periodos = {};
      periodos.forEach((p, j) => {
        if (imp[j] || (cant && cant[j])) k.periodos[p.desde.slice(0, 7)] = { importe: Math.round(imp[j] * 100) / 100, ...(cant ? { cantidad: cant[j] } : {}) };
      });
    }
  }

  const total = Math.round(conceptos.reduce((s, k) => s + k.importe, 0) * 100) / 100;
  const sinFechas = conceptos.filter(k => !k.inicio).length;
  if (!conceptos.length) throw new Error('No encontré partidas con importe en el archivo.');
  if (sinFechas === conceptos.length) avisos.push('El archivo no trae fechas de inicio y fin por partida: el programa a la fecha no se podrá calcular por partida. Usa el programa de obra (AE10).');
  else if (sinFechas) avisos.push(`${sinFechas} partidas no traen fechas de inicio y fin.`);
  const malas = conceptos.filter(k => k.cantidad && k.precio && Math.abs(k.cantidad * k.precio - k.importe) > Math.max(1, k.importe * 0.005));
  if (malas.length) avisos.push(`${malas.length} partidas tienen cantidad × precio distinto al importe (se usa el importe): ${malas.slice(0, 3).map(k => k.clave).join(', ')}…`);
  const nivelSugerido = conceptos.every(k => k.ruta.length > 1 && k.ruta[0] === conceptos[0].ruta[0]) ? 2 : 1;
  return { generales, conceptos, total, avisos, nivelSugerido, periodos: periodos.map(p => p.desde) };
}

// ---------- Navegador ----------
function cargarXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = XLSX_URL; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
}

export async function leerArchivo(file) {
  await cargarXLSX();
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  let mejor = null, ultimoError = null;
  for (const nombre of wb.SheetNames) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: true });
    try {
      const r = parsearHoja(rows);
      if (!mejor || r.conceptos.length > mejor.conceptos.length) mejor = { ...r, hoja: nombre };
    } catch (e) { ultimoError = e; }
  }
  if (!mejor) throw ultimoError || new Error('No encontré partidas en el archivo.');
  return mejor;
}
