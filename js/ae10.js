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
  return null;
}

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
    if (cols.descripcion !== undefined && cols.importe !== undefined && Object.keys(cols).length >= 4) {
      // Columnas de periodo: fechas en el encabezado a la derecha del importe.
      const periodos = [];
      r.forEach((c, j) => { if (j > cols.importe && aFecha(c) && norm(c) !== 'TOTAL') periodos.push({ col: j, desde: aFecha(c) }); });
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

const RUIDO = /^(TOTAL|ACUMULADO|PORCENTAJE|MONTO ESTA HOJA|ACUMULADO ANTERIOR|APODERADO|BARRA=|SUBTOTAL|IVA|IMPORTE CON LETRA|\(\*)/;

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
      hayTotales = true;
      const nombre = mTotal[1];
      const k = pila.map(g => norm(g)).findLastIndex(g => g.startsWith(nombre) || nombre.startsWith(g));
      if (k >= 0) pila.length = k;
      ultimo = null;
      continue;
    }
    if (RUIDO.test(descN) || RUIDO.test(norm(clave))) continue;

    const importe = aNum(r[cols.importe]);
    const unidad = celdaTexto(cols.unidad).trim();
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
      conceptos.push(k);
      ultimo = k;
      continue;
    }

    // Renglón solo con números en columnas de periodo: pertenece a la última partida.
    if (ultimo && vacio(desc) && vacio(clave) && periodos.length && periodos.some(p => esNum(r[p.col]))) {
      ultimo._filasPeriodo.push(periodos.map(p => aNum(r[p.col]) ?? 0));
      continue;
    }

    // Título de grupo. Se descartan restos de descripciones cortadas (empiezan con espacio o minúscula).
    if (!vacio(desc) && vacio(clave) && !unidad && !(importe > 0)) {
      if (/^\s/.test(desc) || /^[a-zà-ü]/.test(desc.trim())) continue;
      const nombre = desc.replace(/\s+/g, ' ').trim();
      // Sin renglones TOTAL no se puede saber la profundidad: se tratan como hermanos.
      if (!hayTotales && pila.length && !rows.slice(i).some(x => (x || []).some(c => /^TOTAL /.test(norm(c))))) pila.length = 0;
      pila.push(nombre);
      ultimo = null;
    }
  }

  // Reparto por periodo: se elige el renglón cuya suma coincide con el importe (o la cantidad).
  for (const k of conceptos) {
    const filas = k._filasPeriodo;
    delete k._filasPeriodo;
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
