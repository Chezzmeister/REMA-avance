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

## Arquitectura
```
App (GitHub Pages) ──usuario y contraseña──▶ Intermediario (Cloudflare Worker + D1) ──▶ OneDrive del administrador
```
- Usuarios, roles, obras y capturas viven en la base de datos D1; las fotos y un respaldo de cada captura en
  `REMA-Reportes/obras/<obra>/` del OneDrive conectado en el portal.
- Roles: **Administrador** (todo + portal), **Gerente** (tablero, edita y elimina en sus obras),
  **Supervisor** (solo captura y sube fotos; ve solo lo suyo y no puede modificar lo ya subido).
- Los permisos los aplica el intermediario; la app solo oculta lo que no corresponde.
- Código del intermediario: carpeta `worker/` del proyecto (no se publica en este repositorio).
