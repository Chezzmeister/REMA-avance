// Genera el PPTX semanal con el mismo contenido del formato de REMA.
import { fmtPct, fmtMoney, fmtM, fechaLarga, fechaCorta } from './calc.js';

const LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
const AZUL = '1F3A5F', VERDE = '2E8B57', GRIS = '6B7280', CLARO = 'E5E7EB', TXT = '111827';

function loadLib() {
  if (window.PptxGenJS) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIB; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el generador de PPTX. Abre la app una vez con señal para dejarlo guardado.'));
    document.head.appendChild(s);
  });
}

const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

function encabezado(sl, titulo, sub, n) {
  sl.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: AZUL } });
  sl.addText(titulo, { x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: AZUL, fontFace: 'Calibri' });
  if (sub) sl.addText(sub, { x: 0.5, y: 0.85, w: 12, h: 0.4, fontSize: 13, color: GRIS });
  if (n) sl.addText(String(n), { x: 12.4, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: GRIS, align: 'right' });
}

function dona(pptx, sl, x, y, pct, color) {
  const p = Math.max(0, Math.min(1, pct || 0)) * 100;
  sl.addChart(pptx.ChartType.doughnut, [{ name: 'a', labels: ['Avance', 'Restante'], values: [p, 100 - p] }], {
    x, y, w: 1.3, h: 1.3, holeSize: 70, chartColors: [color, CLARO], showLegend: false, showValue: false, showPercent: false, showLabel: false, dataLabelColor: 'FFFFFF',
  });
}

function kpi(pptx, sl, x, y, w, titulo, valor, linea1, linea2, pct) {
  sl.addShape('roundRect', { x, y, w, h: 2.2, fill: { color: 'F8FAFC' }, line: { color: CLARO }, rectRadius: 0.08 });
  sl.addText(titulo, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.35, fontSize: 12, bold: true, color: GRIS });
  sl.addText(valor, { x: x + 0.2, y: y + 0.55, w: w - 1.6, h: 0.7, fontSize: 30, bold: true, color: TXT });
  sl.addText(linea1 || '', { x: x + 0.2, y: y + 1.3, w: w - 0.4, h: 0.35, fontSize: 11, color: TXT });
  sl.addText(linea2 || '', { x: x + 0.2, y: y + 1.65, w: w - 0.4, h: 0.35, fontSize: 10, color: GRIS });
  if (pct !== undefined && pct !== null) dona(pptx, sl, x + w - 1.45, y + 0.3, pct, VERDE);
}

function mini(sl, x, y, w, titulo, valor, sub) {
  sl.addShape('roundRect', { x, y, w, h: 1.3, fill: { color: 'F8FAFC' }, line: { color: CLARO }, rectRadius: 0.08 });
  sl.addText(titulo, { x: x + 0.2, y: y + 0.1, w: w - 0.4, h: 0.3, fontSize: 11, bold: true, color: GRIS });
  sl.addText(valor, { x: x + 0.2, y: y + 0.4, w: w - 0.4, h: 0.5, fontSize: 22, bold: true, color: TXT });
  sl.addText(sub, { x: x + 0.2, y: y + 0.9, w: w - 0.4, h: 0.3, fontSize: 9, color: GRIS });
}

const lista = items => items.length ? items.map(i => ({ text: i.texto + (i.autor ? `  (${i.autor}, ${fechaCorta(i.fecha)})` : ''), options: { bullet: true, breakLine: true } })) : [{ text: 'Sin registros esta semana.', options: { color: GRIS } }];

export async function generarPPTX(obra, R, getPhoto) {
  await loadLib();
  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Reporte de avance semanal';

  // 1. Portada
  let sl = pptx.addSlide();
  sl.background = { color: AZUL };
  sl.addText('REPORTE DE AVANCE SEMANAL', { x: 0.7, y: 0.8, w: 12, h: 0.8, fontSize: 34, bold: true, color: 'FFFFFF' });
  sl.addText(obra.nombre, { x: 0.7, y: 1.7, w: 12, h: 0.6, fontSize: 20, color: 'FFFFFF' });
  sl.addText(obra.localidad, { x: 0.7, y: 2.3, w: 12, h: 0.5, fontSize: 16, color: 'D1D5DB' });
  sl.addText(`Avance al ${fechaLarga(R.corte)}`, { x: 0.7, y: 3.0, w: 12, h: 0.5, fontSize: 18, bold: true, color: 'A7F3D0' });
  const datos = [['CLIENTE', obra.cliente], ['CONCURSO No.', obra.concurso], ['FECHA', fechaCorta(obra.fechaConcurso)],
    ['DURACIÓN', `${R.plazo.duracion} días naturales`], ['INICIO DE OBRA', fechaCorta(obra.inicio)], ['FIN DE OBRA', fechaCorta(obra.fin)]];
  datos.forEach(([k, v], i) => {
    const x = 0.7 + (i % 3) * 4.1, y = 4.3 + Math.floor(i / 3) * 1.2;
    sl.addText(k, { x, y, w: 3.9, h: 0.3, fontSize: 10, bold: true, color: 'A7F3D0' });
    sl.addText(v || '', { x, y: y + 0.3, w: 3.9, h: 0.7, fontSize: 12, color: 'FFFFFF', valign: 'top' });
  });

  // 2. Resumen ejecutivo
  sl = pptx.addSlide();
  encabezado(sl, 'Resumen ejecutivo', `Indicadores de plazo, avance de tubería y programa al ${fechaLarga(R.corte)}`, 2);
  const t = R.tuberia.total;
  kpi(pptx, sl, 0.5, 1.5, 4.0, 'Plazo transcurrido', fmtPct(R.plazo.pct), `Día ${R.plazo.dia} de ${R.plazo.duracion}`, `${R.plazo.restantes} días naturales restantes`, R.plazo.pct);
  kpi(pptx, sl, 4.65, 1.5, 4.0, 'Tubería instalada', fmtPct(t.pct), `${fmtM(t.instalado)} de ${fmtM(t.longitud)}`, R.tuberia.tramos.map(x => x.diametro).join(' y '), t.pct);
  kpi(pptx, sl, 8.8, 1.5, 4.0, `Programa a la fecha${R.programa.metodo === 'mensual' ? ' (est.)' : ''}`, fmtPct(R.programa.pct), `${fmtMoney(R.programa.importe)} de ${fmtMoney(R.programa.total)}`, 'Importe programado acumulado', R.programa.pct);
  mini(sl, 0.5, 4.0, 3.0, 'Avance físico real', fmtPct(R.fisico), R.desviacion === null ? 'Sin captura' : `Desviación ${R.desviacion >= 0 ? '+' : ''}${(R.desviacion * 100).toFixed(1)} pts`);
  mini(sl, 3.6, 4.0, 3.0, 'Avance financiero real', fmtPct(R.financiero?.pct), R.financiero ? fmtMoney(R.financiero.importe) : 'Sin captura');
  mini(sl, 6.7, 4.0, 3.0, 'Personal en obra', R.personal ? String(R.personal.valor) : '—', R.personal ? `Al ${fechaCorta(R.personal.fecha)}` : 'Sin captura');
  mini(sl, 9.8, 4.0, 3.0, 'Atrasos', R.atrasos ? `${R.atrasos.valor} días` : '—', R.atrasos ? `Al ${fechaCorta(R.atrasos.fecha)}` : 'Sin captura');
  sl.addText(R.programa.metodo === 'mensual'
    ? 'Programa a la fecha (est.): prorrateo lineal del programa mensual de erogaciones. Avance físico real: avance por grupo ponderado por importe.'
    : 'Programa a la fecha: prorrateo lineal de cada concepto del AE10 entre su fecha de inicio y fin. Avance físico real: avance por grupo ponderado por importe.',
  { x: 0.5, y: 6.5, w: 12.3, h: 0.5, fontSize: 9, color: GRIS });

  // 3. Tubería
  sl = pptx.addSlide();
  encabezado(sl, 'Instalación de tubería', 'Barra gris: longitud total. Barra verde: tramo instalado. Fuente: captura de residentes de obra.', 3);
  let y = 1.5;
  for (const tr of R.tuberia.tramos) {
    sl.addText(`${tr.frente} · Tubería de ${tr.diametro}`, { x: 0.5, y, w: 6, h: 0.35, fontSize: 14, bold: true, color: TXT });
    sl.addText(tr.zanja || '', { x: 6.5, y, w: 3, h: 0.35, fontSize: 11, color: GRIS });
    sl.addText(fmtPct(tr.pct), { x: 10.8, y, w: 2, h: 0.35, fontSize: 18, bold: true, color: VERDE, align: 'right' });
    sl.addShape('rect', { x: 0.5, y: y + 0.45, w: 12.3, h: 0.3, fill: { color: '374151' } });
    sl.addShape('rect', { x: 0.5, y: y + 0.45, w: Math.max(0.01, 12.3 * Math.min(1, tr.pct)), h: 0.3, fill: { color: VERDE } });
    sl.addText(`${fmtM(tr.instalado)} instalados de ${fmtM(tr.longitud)}   ·   Por instalar: ${fmtM(tr.restante)}`, { x: 0.5, y: y + 0.8, w: 12.3, h: 0.3, fontSize: 11, color: GRIS });
    y += 1.35;
  }
  for (const f of R.tuberia.frentes) {
    sl.addText(`Total ${f.frente}: ${fmtM(f.instalado)} de ${fmtM(f.longitud)}  ·  ${fmtPct(f.pct)}`, { x: 0.5, y, w: 12.3, h: 0.4, fontSize: 14, bold: true, color: AZUL });
    y += 0.45;
  }

  // 4. Programa de erogaciones
  sl = pptx.addSlide();
  encabezado(sl, 'Programa de erogaciones (AE10)', `Monto del programa: ${fmtMoney(R.programa.total, 2)}`, 4);
  const filasP = [[{ text: 'Periodo', options: { bold: true, color: 'FFFFFF', fill: { color: AZUL } } }, { text: 'Importe', options: { bold: true, color: 'FFFFFF', fill: { color: AZUL } } }, { text: '% periodo', options: { bold: true, color: 'FFFFFF', fill: { color: AZUL } } }, { text: '% acumulado', options: { bold: true, color: 'FFFFFF', fill: { color: AZUL } } }],
    ...R.periodos.map(p => [p.nombre, fmtMoney(p.monto, 2), fmtPct(p.pct), fmtPct(p.pctAcum)])];
  sl.addTable(filasP, { x: 0.5, y: 1.5, w: 6.2, fontSize: 12, border: { type: 'solid', color: CLARO, pt: 1 }, rowH: 0.4 });
  sl.addChart(pptx.ChartType.bar, [{ name: 'Monto programado', labels: R.periodos.map(p => p.nombre), values: R.periodos.map(p => Math.round(p.monto)) }],
    { x: 7.0, y: 1.4, w: 5.8, h: 3.8, barDir: 'col', chartColors: [AZUL], showValue: false, valAxisLabelFormatCode: '$#,##0', catAxisLabelFontSize: 11, valAxisLabelFontSize: 9 });
  sl.addText(`Programado al ${fechaLarga(R.corte)}${R.programa.metodo === 'mensual' ? ' (est.)' : ''}: ${fmtMoney(R.programa.importe)} · ${fmtPct(R.programa.pct)}`, { x: 0.5, y: 5.6, w: 12.3, h: 0.4, fontSize: 14, bold: true, color: AZUL });
  sl.addText(`Ejecutado real acumulado: ${R.financiero ? `${fmtMoney(R.financiero.importe)} · ${fmtPct(R.financiero.pct)}` : 'sin captura'}`, { x: 0.5, y: 6.0, w: 12.3, h: 0.4, fontSize: 13, color: TXT });

  // 5. Grupos
  sl = pptx.addSlide();
  encabezado(sl, 'Distribución del programa por grupo de conceptos', null, 5);
  const h = { bold: true, color: 'FFFFFF', fill: { color: AZUL } };
  const filasG = [[{ text: 'Grupo', options: h }, { text: 'Importe (AE10)', options: h }, { text: '%', options: h }, { text: 'Avance real', options: h }],
    ...R.grupos.filas.map(g => [g.nombre, fmtMoney(g.importe, 2), fmtPct(g.peso), fmtPct(g.avance)]),
    [{ text: 'Total', options: { bold: true } }, { text: fmtMoney(R.grupos.total, 2), options: { bold: true } }, { text: '100.0%', options: { bold: true } }, { text: fmtPct(R.fisico), options: { bold: true } }]];
  sl.addTable(filasG, { x: 0.5, y: 1.3, w: 7.6, fontSize: 11, border: { type: 'solid', color: CLARO, pt: 1 }, rowH: 0.42, colW: [3.4, 1.9, 1.0, 1.3] });
  sl.addChart(pptx.ChartType.doughnut, [{ name: 'Grupos', labels: R.grupos.filas.map(g => g.nombre), values: R.grupos.filas.map(g => g.importe) }],
    { x: 8.4, y: 1.2, w: 4.6, h: 4.6, holeSize: 55, showLegend: true, legendPos: 'b', legendFontSize: 9, showPercent: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: 9,
      chartColors: ['1F3A5F', '2E8B57', 'D97706', '7C3AED', '0891B2', '9CA3AF'] });

  // 6. Fotos
  sl = pptx.addSlide();
  encabezado(sl, 'Registro fotográfico', `Semana del ${fechaCorta(R.desde)} al ${fechaCorta(R.corte)}`, 6);
  const fotos = R.fotos.slice(-4);
  for (let i = 0; i < 4; i++) {
    const x = 0.5 + (i % 2) * 6.25, yy = 1.35 + Math.floor(i / 2) * 2.85;
    const f = fotos[i];
    const blob = f ? await getPhoto(f.id) : null;
    if (blob) sl.addImage({ data: await blobToDataUrl(blob), x, y: yy, w: 6.0, h: 2.35, sizing: { type: 'cover', w: 6.0, h: 2.35 } });
    else sl.addShape('rect', { x, y: yy, w: 6.0, h: 2.35, fill: { color: 'F3F4F6' }, line: { color: CLARO } });
    sl.addText(f ? `${f.frente || ''}${f.frente && f.caption ? ' · ' : ''}${f.caption || ''}  ·  ${fechaCorta(f.fecha)}` : 'Sin fotografía', { x, y: yy + 2.37, w: 6.0, h: 0.3, fontSize: 10, color: GRIS });
  }

  // 7. Observaciones
  sl = pptx.addSlide();
  encabezado(sl, 'Observaciones y programa de la próxima semana', null, 7);
  [['Actividades de la próxima semana', R.actividades], ['Atrasos y problemática', R.problematica], ['Requerimientos y acuerdos', R.requerimientos]].forEach(([tit, items], i) => {
    const x = 0.5 + i * 4.15;
    sl.addShape('rect', { x, y: 1.3, w: 4.0, h: 0.5, fill: { color: AZUL } });
    sl.addText(tit, { x: x + 0.1, y: 1.3, w: 3.8, h: 0.5, fontSize: 12, bold: true, color: 'FFFFFF' });
    sl.addText(lista(items), { x, y: 1.9, w: 4.0, h: 5.0, fontSize: 11, color: TXT, valign: 'top' });
  });

  await pptx.writeFile({ fileName: `Reporte avance semanal ${R.corte}.pptx` });
}
