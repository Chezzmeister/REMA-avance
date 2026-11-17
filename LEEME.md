# REMA · Avance semanal (app web sin señal)

App web instalable (PWA) para capturar el avance de obra desde Android, iPhone o Windows.
Funciona **sin señal**: todo se guarda en el teléfono y se sube a OneDrive en cuanto hay conexión.
Calcula sola los indicadores y genera el PPTX del reporte semanal.

## Cómo funciona sin señal
- La primera vez se abre con señal: la app completa (incluidas las librerías de Microsoft y del PPTX) queda guardada en el teléfono.
- Cada captura y cada foto se guarda en el teléfono (IndexedDB) y entra a una cola de subida.
- La cola se sube al abrir la app, al volver la señal y cada minuto mientras esté abierta.
- Los borradores se guardan mientras se escribe: si se cierra la app a medias, no se pierde nada.
- Las fotos se reducen a ~1600 px (unos 300 KB) para que suban con señal débil.

**Límites que hay que conocer**
- En iPhone la subida ocurre **con la app abierta** (iOS no deja subir en segundo plano). Basta abrirla con señal.
- La sesión de Microsoft dura unas 24 h sin uso con señal. Si vence, la app avisa "Inicia sesión para subir";
  lo capturado sigue guardado y sube al iniciar sesión.
- En iPhone hay que **agregarla a la pantalla de inicio** (Compartir → Agregar a inicio). Así iOS no borra sus datos.

## Estructura en OneDrive
```
REMA-Reportes/obras/<obra>/obra.json            datos base de la obra
REMA-Reportes/obras/<obra>/capturas/<id>.json   una captura por archivo
REMA-Reportes/obras/<obra>/fotos/<id>.jpg
```
Como cada captura es un archivo distinto, varios residentes pueden subir al mismo tiempo sin pisarse.

## Cálculos
| Indicador | Cálculo |
|---|---|
| Plazo transcurrido | día de corte − inicio + 1, entre la duración |
| Tubería | metros iniciales + metros capturados, por tramo, diámetro y frente |
| Programa a la fecha | prorrateo lineal de cada partida del AE10 (o del programa mensual si no hay partidas) |
| Avance físico real | % por grupo (último capturado) ponderado por el importe del grupo |
| Avance financiero | importe ejecutado acumulado (último capturado) entre el monto total |
| Desviación | físico real − programa |

## Datos de la obra
El código es público, así que los datos de la obra no viven aquí: se cargan con *Ajustes → Importar respaldo*
y, una vez en OneDrive, los demás teléfonos los bajan solos.

## Pendiente para salir a campo
1. **Partidas del AE10**: pegar las 36 partidas en *Obra* (Clave, Descripción, Grupo, Importe, Inicio, Fin).
   Sin ellas, el programa se estima prorrateando el programa mensual.
2. **Publicar** la carpeta `app/` en un hosting gratuito con HTTPS (GitHub Pages, Netlify o Cloudflare Pages).
3. **Registrar la app en Microsoft Entra** (gratis) para obtener el *Client ID*:
   - Tipo de cuenta: "Cuentas personales de Microsoft y de cualquier organización".
   - Plataforma: *Single-page application*, URI de redirección = la URL publicada.
   - Permisos delegados de Graph: `User.Read`, `Files.ReadWrite.All`.
4. En OneDrive, crear la carpeta `REMA-Reportes`, compartirla **con permiso de edición** a cada residente
   y pegar el link en *Ajustes → Link de la carpeta compartida* de cada teléfono.

## Probar en esta computadora
```bash
python -m http.server 8765 --directory app
```
Abrir http://localhost:8765
