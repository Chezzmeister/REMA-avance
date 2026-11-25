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

// Nombres de columna que se reconocen solos (el texto ya viene sin acentos, en mayúsculas y sin
// puntos sobrantes; "M.N.", "SIN IVA" y "($)" se ignoran).
export const CAMPOS = {
  clave: 'Clave', descripcion: 'Descripción', unidad: 'Unidad', cantidad: 'Cantidad',
  precio: 'Precio unitario', importe: 'Importe', inicio: 'Fecha de inicio', fin: 'Fecha de término',
};
const COLUMNAS = {
  clave: t => /^(CODIGO|CLAVE|CVE|CLAVE DEL CONCEPTO)$/.test(t),
  descripcion: t => /^(DESCRIPCION|CONCEPTO)/.test(t),
  unidad: t => /^(UNIDAD|UNID|UND|U|UM|U DE M|UNIDAD DE MEDIDA|U MEDIDA)$/.test(t),
  cantidad: t => /^(CANTIDAD|VOLUMEN|CANT|CANTIDAD TOTAL|CANT TOTAL|VOL|VOLUMEN TOTAL)$/.test(t),
  precio: t => /^(PRECIO|PRECIO UNITARIO|PU|P U|P UNITARIO|PRECIO U|PRECIO UNIT)$/.test(t),
  importe: t => /^(IMPORTE|IMPORTE TOTAL|TOTAL|MONTO|MONTO TOTAL)$/.test(t),
  inicio: t => /^(INICIO|FECHA INICIO|FECHA DE INICIO|F INICIO|INICIA)$/.test(t),
  fin: t => /^(FIN|TERMINO|FECHA FIN|FECHA DE FIN|F FIN|FECHA TERMINO|FECHA DE TERMINO|TERMINA|FINAL)$/.test(t),
};
const limpiarEnc = c => norm(c).replace(/\(\$\)|\$|\bM\.? ?N\.?$|\bSIN IVA\b/g, '').replace(/[.:]/g, ' ').replace(/\s+/g, ' ').trim();
export const letraCol = j => { let s = ''; for (j++; j > 0; j = Math.floor((j - 1) / 26)) s = String.fromCharCode(65 + (j - 1) % 26) + s; return s; };

// Lee el renglón i como encabezado. cols: columnas elegidas a mano ({campo: índice}, -1 = no tiene).
function leerEncabezado(rows, i, manual) {
  const r = rows[i] || [];
  const cols = {};
  r.forEach((c, j) => {
    const t = limpiarEnc(c);
    for (const [k, f] of Object.entries(COLUMNAS)) if (cols[k] === undefined && t && f(t)) cols[k] = j;
  });
  if (manual) for (const [k, j] of Object.entries(manual)) { if (j === null || j === undefined || j < 0) delete cols[k]; else cols[k] = +j; }
  const sinImporte = cols.importe === undefined && cols.cantidad !== undefined && cols.precio !== undefined;
  if (!manual && !(cols.descripcion !== undefined && (cols.importe !== undefined || sinImporte) && Object.keys(cols).length >= 4)) return null;
  // Columnas de periodo: fechas (o meses en texto) en el encabezado, a la derecha de las columnas fijas.
  const fijas = Math.max(...['cantidad', 'precio', 'inicio', 'fin'].map(k => cols[k] ?? -1));
  const periodos = [];
  r.forEach((c, j) => { if (j > fijas && !Object.values(cols).includes(j) && aFecha(c)) periodos.push({ col: j, desde: aFecha(c) }); });
  // Un "Total" a la derecha de los meses es la suma del renglón (cantidad o importe según el
  // renglón), no el importe de la partida: entonces el importe es cantidad × precio.
  let colTotal = r.findIndex((c, j) => periodos.length && j > periodos[periodos.length - 1].col && /^TOTAL/.test(limpiarEnc(c)));
  if (!(manual && 'importe' in manual) && cols.importe !== undefined && periodos.length && cols.importe > periodos[0].col && cols.cantidad !== undefined && cols.precio !== undefined) {
    colTotal = cols.importe; delete cols.importe;
  }
  return { fila: i, cols, periodos, colTotal: colTotal >= 0 ? colTotal : undefined, manual: !!manual };
}

function buscarEncabezado(rows) {
  for (let i = 0; i < Math.min(rows.length, 80); i++) { const e = leerEncabezado(rows, i); if (e) return e; }
  return null;
}

// Renglones que podrían ser el encabezado, para elegirlo a mano.
export function candidatosEncabezado(rows) {
  const out = [];
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const textos = (rows[i] || []).filter(c => typeof c === 'string' && c.trim());
    const numeros = (rows[i] || []).filter(c => typeof c === 'number').length;
    if (textos.length >= 3 && numeros * 2 <= textos.length) out.push({ fila: i, texto: textos.map(c => c.trim()).join(' · ').slice(0, 90) });
  }
  return out;
}
// Columnas que se reconocen solas en el renglón elegido como encabezado.
export function columnasSugeridas(rows, fila) {
  const e = leerEncabezado(rows, fila) || leerEncabezado(rows, fila, {});
  const cols = { ...e.cols };
  // Un "Total" a la derecha de los meses nunca es el importe de la partida.
  if (cols.importe !== undefined && e.periodos.length && cols.importe > e.periodos[0].col) delete cols.importe;
  return cols;
}
export const firmaEncabezado = r => (r || []).map(limpiarEnc).filter(Boolean).join('|').slice(0, 300);

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

// opciones.fila / opciones.cols: encabezado y columnas elegidos a mano.
export function parsearHoja(rows, opciones = {}) {
  const enc = opciones.fila !== undefined && opciones.fila !== null ? leerEncabezado(rows, +opciones.fila, opciones.cols || {}) : buscarEncabezado(rows);
  if (!enc) throw Object.assign(new Error('No encontré el renglón de encabezados (columnas como Clave, Descripción, Unidad, Cantidad, Precio, Importe). Elige abajo cuál es.'), { sinEncabezado: true });
  const { cols, periodos } = enc;
  if (cols.descripcion === undefined) throw Object.assign(new Error('Falta indicar qué columna trae la descripción.'), { sinEncabezado: true });
  if (cols.importe === undefined && (cols.cantidad === undefined || cols.precio === undefined)) throw Object.assign(new Error('Falta indicar la columna de importe, o las de cantidad y precio unitario.'), { sinEncabezado: true });
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
  if (!conceptos.length) throw Object.assign(new Error('No encontré partidas con importe en el archivo. Revisa abajo qué columnas se usaron.'), { sinEncabezado: true });
  if (sinFechas === conceptos.length) avisos.push('El archivo no trae fechas de inicio y fin por partida: el programa a la fecha no se podrá calcular por partida. Usa el programa de obra (AE10).');
  else if (sinFechas) avisos.push(`${sinFechas} partidas no traen fechas de inicio y fin.`);
  const nivelSugerido = conceptos.every(k => k.ruta.length > 1 && k.ruta[0] === conceptos[0].ruta[0]) ? 2 : 1;
  const revision = revisar({ rows, enc, conceptos, total, avisos });
  return {
    generales, conceptos, total, avisos, revision, nivelSugerido, periodos: periodos.map(p => p.desde),
    encabezado: { fila: enc.fila, cols: { ...cols }, manual: enc.manual, periodos: periodos.length },
  };
}

// ---------- Revisión: se compara lo leído contra los totales que trae el propio archivo ----------
const TOTAL_ARCHIVO = /^(TOTAL (DEL? )?(PRESUPUESTO|GENERAL|OBRA|LA OBRA|CATALOGO)|IMPORTE TOTAL( DE LA (OBRA|PROPUESTA))?|MONTO TOTAL|SUMA TOTAL|GRAN TOTAL)/;

function revisar({ rows, enc, conceptos, total, avisos }) {
  const { cols, periodos, colTotal } = enc;
  const rev = [];
  const fmt = n => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const igual = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);

  // 1. Total de la obra contra el renglón de total del archivo.
  const candidatos = [];
  for (let i = enc.fila + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const etiqueta = r.map(c => (typeof c === 'string' ? norm(c).replace(/:$/, '') : '')).find(t => TOTAL_ARCHIVO.test(t));
    if (!etiqueta) continue;
    const meses = periodos.map(p => aNum(r[p.col]));
    let valor = [cols.importe, colTotal].map(j => (j === undefined ? null : aNum(r[j]))).find(v => v !== null && v > 0);
    if (valor === undefined && meses.some(v => v)) valor = meses.reduce((s, v) => s + (v || 0), 0);
    if (valor === undefined) { const nums = r.map(aNum).filter(v => v !== null && v > 0); valor = nums[nums.length - 1]; }
    if (valor) candidatos.push({ etiqueta, valor, meses, conIva: /\bIVA\b/.test(etiqueta) && !/SIN IVA/.test(etiqueta) });
  }
  const coincide = candidatos.find(c => igual(c.valor, total));
  const conIva = !coincide && candidatos.find(c => igual(c.valor, total * 1.16));
  if (coincide || conIva) rev.push({ nivel: 'ok', texto: `El total leído (${fmt(total)}) coincide con "${(coincide || conIva).etiqueta.toLowerCase()}" del archivo${conIva ? ' (antes de IVA)' : ''}.` });
  else if (candidatos.length) {
    const c = candidatos.find(x => !x.conIva) || candidatos[0];
    rev.push({ nivel: 'error', texto: `El total leído (${fmt(total)}) no coincide con "${c.etiqueta.toLowerCase()}" del archivo (${fmt(c.valor)}). Probablemente alguna columna se leyó mal: revisa las columnas abajo.` });
  } else rev.push({ nivel: 'aviso', texto: `No encontré en el archivo un renglón de total para comparar. Revisa que el total leído (${fmt(total)}) sea el de la obra.` });

  // 2. Cada mes contra los totales por mes del archivo.
  if (periodos.length) {
    const porMes = periodos.map(p => conceptos.reduce((s, k) => s + (k.periodos?.[p.desde.slice(0, 7)]?.importe || 0), 0));
    const ref = (coincide || conIva) && (coincide || conIva).meses.some(v => v) ? (coincide || conIva) : candidatos.find(c => c.meses.some(v => v) && igual(c.meses.reduce((s, v) => s + (v || 0), 0), total));
    if (ref) {
      const malos = periodos.filter((p, j) => !igual(porMes[j], ref.meses[j] || 0));
      if (malos.length) rev.push({ nivel: 'error', texto: `${malos.length} de ${periodos.length} meses no coinciden con los totales por mes del archivo (${malos.slice(0, 3).map(p => p.desde.slice(0, 7)).join(', ')}${malos.length > 3 ? '…' : ''}).` });
      else rev.push({ nivel: 'ok', texto: `Los ${periodos.length} meses del programa coinciden con los totales por mes del archivo.` });
    }
    const sinReparto = conceptos.filter(k => !k.periodos);
    if (sinReparto.length) rev.push({ nivel: sinReparto.length > conceptos.length / 3 ? 'error' : 'aviso', texto: `${sinReparto.length} partidas no tienen un reparto por mes que sume su importe: ${sinReparto.slice(0, 3).map(k => k.clave || k.descripcion.slice(0, 20)).join(', ')}${sinReparto.length > 3 ? '…' : ''}.` });
    // Meses con importe fuera de las fechas de las partidas.
    const ini = conceptos.map(k => k.inicio).filter(Boolean).sort()[0];
    const fin = conceptos.map(k => k.fin).filter(Boolean).sort().pop();
    if (ini && fin) {
      const fuera = periodos.filter((p, j) => porMes[j] > 0 && (p.desde.slice(0, 7) < ini.slice(0, 7) || p.desde.slice(0, 7) > fin.slice(0, 7)));
      if (fuera.length) rev.push({ nivel: 'aviso', texto: `Hay importe programado en meses fuera de las fechas de las partidas (${fuera.map(p => p.desde.slice(0, 7)).join(', ')}). Revisa que los meses del encabezado sean correctos.` });
    }
  } else if (conceptos.some(k => k.inicio)) {
    rev.push({ nivel: 'aviso', texto: 'No encontré columnas de meses en el encabezado: el programa de erogaciones se calculará con las fechas de cada partida.' });
  }

  // 3. Importes que parecen cantidades (o al revés).
  const conPrecio = conceptos.filter(k => k.cantidad && k.precio);
  const malas = conPrecio.filter(k => Math.abs(k.cantidad * k.precio - k.importe) > Math.max(1, k.importe * 0.005));
  if (malas.length) {
    const comoCantidad = malas.filter(k => igual(k.importe, k.cantidad)).length;
    const grave = malas.length > conPrecio.length * 0.3;
    rev.push({ nivel: grave ? 'error' : 'aviso', texto: comoCantidad > malas.length / 2
      ? `En ${malas.length} partidas el importe es igual a la cantidad: la columna de importe parece ser de cantidades.`
      : `${malas.length} partidas tienen cantidad × precio distinto al importe (se usa el importe): ${malas.slice(0, 3).map(k => k.clave).join(', ')}${malas.length > 3 ? '…' : ''}.` });
  }
  for (const a of avisos) rev.push({ nivel: 'aviso', texto: a });
  return rev;
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

// Columnas elegidas a mano: se recuerdan en este equipo por la forma del encabezado, para que
// la próxima vez que llegue un archivo con el mismo formato se lea igual.
const MEMORIA = 'rema-columnas';
function memoria() { try { return JSON.parse(localStorage.getItem(MEMORIA) || '{}'); } catch { return {}; } }
export function recordarColumnas(rows, fila, cols) {
  try {
    const m = memoria();
    m[firmaEncabezado(rows[fila])] = { cols, usado: Date.now() };
    const claves = Object.keys(m).sort((a, b) => m[b].usado - m[a].usado).slice(0, 30);
    localStorage.setItem(MEMORIA, JSON.stringify(Object.fromEntries(claves.map(k => [k, m[k]]))));
  } catch { /* sin almacenamiento: no se recuerda */ }
}
function recordadas(rows) {
  const m = memoria();
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const f = firmaEncabezado(rows[i]);
    if (f && m[f]) return { fila: i, cols: m[f].cols };
  }
  return null;
}

let libro = null; // último archivo leído: { hojas: {nombre: rows} }
export const filasDe = hoja => libro?.hojas[hoja] || [];

// Lee el archivo y elige la hoja con más partidas. Si falla, el error trae las hojas y los
// renglones candidatos a encabezado para elegirlos a mano.
export async function leerArchivo(file) {
  await cargarXLSX();
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  libro = { hojas: {} };
  for (const nombre of wb.SheetNames) libro.hojas[nombre] = window.XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: true });
  let mejor = null, ultimoError = null;
  for (const nombre of wb.SheetNames) {
    const rows = libro.hojas[nombre];
    const rec = recordadas(rows);
    for (const op of rec ? [rec, {}] : [{}]) {
      try {
        const r = parsearHoja(rows, op);
        if (!mejor || r.conceptos.length > mejor.conceptos.length) mejor = { ...r, hoja: nombre, recordado: op === rec };
        break;
      } catch (e) { ultimoError = e; }
    }
  }
  if (!mejor) {
    const hoja = wb.SheetNames.map(n => [n, candidatosEncabezado(libro.hojas[n]).length]).sort((a, b) => b[1] - a[1])[0][0];
    throw Object.assign(ultimoError || new Error('No encontré partidas en el archivo.'), { sinEncabezado: true, hojas: wb.SheetNames, hoja });
  }
  return { ...mejor, hojas: wb.SheetNames };
}

// Vuelve a leer el último archivo con el encabezado y las columnas elegidos a mano.
export function releer(hoja, fila, cols) {
  const r = parsearHoja(filasDe(hoja), { fila, cols });
  return { ...r, hoja, hojas: Object.keys(libro.hojas), manual: true };
}
