// Motor de cálculo: todo lo que el reporte muestra sale de aquí.
// Fechas como 'AAAA-MM-DD'; se convierten a número de día (UTC) para evitar husos horarios.

export const d2n = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
export const n2d = n => new Date(n * 86400000).toISOString().slice(0, 10);
export const hoy = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const clamp01 = x => Math.max(0, Math.min(1, x));
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const nombreMes = m => MESES[+m.slice(5, 7) - 1];
export const fechaLarga = s => `${+s.slice(8, 10)} de ${MESES[+s.slice(5, 7) - 1].toLowerCase()} de ${s.slice(0, 4)}`;
export const fechaCorta = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';

const vivos = (records, corte) => records
  .filter(r => !r.borrado && r.fecha <= corte)
  .sort((a, b) => (a.fecha === b.fecha ? (a.creado || 0) - (b.creado || 0) : a.fecha < b.fecha ? -1 : 1));

// Último valor capturado (≤ fecha de corte) de un campo.
function ultimo(records, corte, getter) {
  const rs = vivos(records, corte);
  for (let i = rs.length - 1; i >= 0; i--) {
    const v = getter(rs[i]);
    if (v !== undefined && v !== null && v !== '') return { valor: v, fecha: rs[i].fecha };
  }
  return null;
}

export function montoTotal(obra) {
  if (obra.conceptos?.length) return obra.conceptos.reduce((s, k) => s + (+k.importe || 0), 0);
  return +obra.montoTotal || obra.programaMensual.reduce((s, m) => s + m.monto, 0);
}

export function plazo(obra, corte) {
  const ini = d2n(obra.inicio), fin = d2n(obra.fin);
  const duracion = fin - ini + 1;
  const dia = Math.max(0, Math.min(d2n(corte) - ini + 1, duracion));
  return { dia, duracion, restantes: duracion - dia, pct: dia / duracion };
}

function rangoMes(mes, obra) {
  const a = d2n(mes + '-01');
  const sig = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 1)).getTime() / 86400000;
  return [Math.max(a, d2n(obra.inicio)), Math.min(sig - 1, d2n(obra.fin))];
}

// Programa a la fecha: prorrateo lineal de cada partida entre su inicio y su fin.
// Sin partidas capturadas, se prorratea cada mes del programa de erogaciones.
export function programa(obra, corte) {
  const c = d2n(corte);
  const total = montoTotal(obra);
  let importe = 0, metodo;
  if (obra.conceptos?.length) {
    metodo = 'conceptos';
    for (const k of obra.conceptos) {
      const a = d2n(k.inicio), b = d2n(k.fin);
      importe += (+k.importe || 0) * clamp01((c - a + 1) / (b - a + 1));
    }
  } else {
    metodo = 'mensual';
    for (const m of obra.programaMensual) {
      const [a, b] = rangoMes(m.mes, obra);
      importe += m.monto * clamp01((c - a + 1) / (b - a + 1));
    }
  }
  return { importe, total, pct: total ? importe / total : 0, metodo };
}

// Programa por mes (periodo y acumulado).
export function periodos(obra) {
  let porMes;
  if (obra.conceptos?.length) {
    const map = {};
    for (const k of obra.conceptos) {
      const a = d2n(k.inicio), b = d2n(k.fin), dias = b - a + 1;
      for (let d = a; d <= b; d++) {
        const mes = n2d(d).slice(0, 7);
        map[mes] = (map[mes] || 0) + (+k.importe || 0) / dias;
      }
    }
    porMes = Object.keys(map).sort().map(mes => ({ mes, monto: map[mes] }));
  } else {
    porMes = obra.programaMensual.slice().sort((a, b) => (a.mes < b.mes ? -1 : 1));
  }
  const total = porMes.reduce((s, m) => s + m.monto, 0);
  let acum = 0;
  return porMes.map(m => {
    acum += m.monto;
    return { mes: m.mes, nombre: nombreMes(m.mes), monto: m.monto, pct: m.monto / total, pctAcum: acum / total };
  });
}

export function tuberia(obra, records, corte) {
  const rs = vivos(records, corte);
  const tramos = obra.tramos.map(t => {
    let m = t.inicial && t.inicial.fecha <= corte ? +t.inicial.metros || 0 : 0;
    for (const r of rs) m += +(r.tuberia?.[t.id]) || 0;
    return { ...t, instalado: m, pct: t.longitud ? m / t.longitud : 0, restante: Math.max(0, t.longitud - m), excede: m > t.longitud };
  });
  const frentes = {};
  for (const t of tramos) {
    const f = frentes[t.frente] ||= { frente: t.frente, instalado: 0, longitud: 0, diametros: [] };
    f.instalado += t.instalado; f.longitud += t.longitud; f.diametros.push(t.diametro);
  }
  const lista = Object.values(frentes).map(f => ({ ...f, pct: f.longitud ? f.instalado / f.longitud : 0 }));
  const inst = tramos.reduce((s, t) => s + t.instalado, 0), lon = tramos.reduce((s, t) => s + t.longitud, 0);
  return { tramos, frentes: lista, total: { instalado: inst, longitud: lon, pct: lon ? inst / lon : 0 } };
}

export function grupos(obra, records, corte) {
  const total = obra.grupos.reduce((s, g) => s + g.importe, 0);
  const filas = obra.grupos.map(g => {
    const u = ultimo(records, corte, r => r.avanceGrupos?.[g.id]);
    return { ...g, peso: total ? g.importe / total : 0, avance: u ? +u.valor / 100 : null };
  });
  const capturados = filas.filter(f => f.avance !== null);
  const fisico = capturados.length ? filas.reduce((s, f) => s + f.peso * (f.avance || 0), 0) : null;
  return { filas, total, fisico };
}

export function resumen(obra, records, corte) {
  const pl = plazo(obra, corte);
  const pr = programa(obra, corte);
  const tu = tuberia(obra, records, corte);
  const gr = grupos(obra, records, corte);
  const fin = ultimo(records, corte, r => r.importeEjecutado);
  const total = montoTotal(obra);
  const personal = ultimo(records, corte, r => r.personal);
  const atrasos = ultimo(records, corte, r => r.atrasosDias);
  const desde = n2d(d2n(corte) - 6);
  const semana = vivos(records, corte).filter(r => r.fecha >= desde);
  const textos = campo => semana.filter(r => r[campo]?.trim()).map(r => ({ texto: r[campo].trim(), autor: r.autor, fecha: r.fecha }));
  return {
    corte, desde, plazo: pl, programa: pr, tuberia: tu, grupos: gr,
    periodos: periodos(obra),
    fisico: gr.fisico,
    financiero: fin ? { importe: +fin.valor, pct: +fin.valor / total, fecha: fin.fecha } : null,
    desviacion: gr.fisico === null ? null : gr.fisico - pr.pct,
    personal, atrasos,
    actividades: textos('actividades'),
    problematica: textos('problematica'),
    requerimientos: textos('requerimientos'),
    fotos: semana.flatMap(r => (r.fotos || []).map(f => ({ ...f, fecha: f.fecha || r.fecha, autor: r.autor }))),
  };
}

export const fmtPct = (x, d = 1) => (x === null || x === undefined || isNaN(x) ? '—' : (x * 100).toFixed(d) + '%');
export const fmtMoney = (x, d = 0) => (x === null || x === undefined ? '—' : '$' + x.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtM = x => x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m';
