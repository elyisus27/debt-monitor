# Resumen del proyecto (para administración)

Este documento es el único que necesitas leer para saber en qué vamos y
qué se decidió. Todo lo demás (`developersDocs/`) es documentación técnica
profunda — manuales, endpoints, código — pensada para que yo (Claude) no
tenga que redescubrir las cosas cada sesión, no para que tú la leas.

## Qué hace el proyecto, en una frase

Cuando una casa marca su NIP en la caseta, detectar automático **qué auto
es** (placa, marca, modelo), para poder sacar estadística de cuántos autos
distintos entran a cada casa y con qué frecuencia, y — el objetivo
específico para casas morosas — **no dejar entrar visitas usando el NIP
de un moroso**: si el auto que se presenta no es de los autorizados de esa
casa, se detecta.

## Arquitectura formal (2026-08-23) — ya está en producción

Se dejó de parchar el prototipo (`tools/httphosts-probe/`, puro Node sin
framework) y se armó el sistema de verdad, con tecnología estándar:

- **`apps/api`** (NestJS + base de datos formal vía Prisma) — recibe los
  eventos del teclado, pide las fotos al DVR, manda a leer la placa, y
  expone todo por API. Corre en el puerto **9100** (el mismo que ya tenían
  configurado los teclados — no hubo que tocarlos).
- **`apps/web`** (Next.js + React) — la pantalla real, con diseño hecho a
  la medida (a partir de un mockup que armaste en Claude Design):
  filtros, KPIs, listado, panel de "último cruce", visor de fotos con
  navegación por teclado (←/→/Esc/↑/↓/Enter), y captura manual de placa
  cuando el OCR falla. Corre en el puerto **3000**:
  **`http://192.168.196.9:3000`**
- **`tools/plate-reader`** (el lector de placas en Python) sigue igual,
  puerto 9300 — el sistema nuevo también depende de él, no se tocó.

`ingest.js` y `viewer.js` (el prototipo original) ya se borraron — quedan
reemplazados por lo de arriba. El corte se probó con eventos reales antes
y después de apagar el sistema viejo, sin perder nada.

## Reinicio de datos (2026-08-22)

Se borró todo lo que había hasta este punto — el histórico completo
(archivo crudo original, JSON parseado, y los eventos en la base de
datos) — porque ninguno de esos datos traía auto/placa asociado, que es
justo lo único que le da valor para el objetivo de arriba: un registro de
"la casa X marcó a las Y hora" sin saber qué auto entró no sirve para
contar autos ni para detectar visitas. De aquí en adelante, cada evento sí
va a traer su foto en buena calidad desde el momento en que se guarda
(Fase 3, ya funcionando) — así que vale más empezar a acumular limpio que
cargar con lo de antes.

## Fase 1 — Recibir el aviso del teclado ✅ Cerrada

**Qué se hizo:** el teclado Hikvision se configuró para avisarnos a
nosotros (no a un tercero) cada vez que alguien marca un NIP. Se le dio la
IP y puerto de nuestra propia computadora escuchando, con una instrucción
tipo `PUT` sobre su configuración (`httpHosts`). En cuanto detecta el
marcado, nos manda un aviso HTTP al instante — no hay que ir a
preguntarle, él nos busca a nosotros.

**Por qué importa:** confirma que sí es tiempo real, no encuesta cada
rato. Se probó contra los 2 teclados reales del sitio (entrada y salida),
no en laboratorio.

## Fase 2 — Guardar los avisos de forma ordenada ✅ Cerrada

**Qué se hizo:** cada aviso que llega se filtra (se descarta ruido —
puertas abrir/cerrar, fallas de red — que no es un NIP real) y se guarda
en una base de datos (SQLite, un archivo local, sencillo, sin necesidad de
un servidor de base de datos aparte por ahora) con: casa, hora exacta,
puerta (entrada/salida).

**Resultado real (en su momento):** 1085 eventos guardados, de 102+ casas
distintas. *(Ese dato ya no está — ver "Reinicio de datos" más abajo. Lo
que demostró esta fase, que el modelo y el guardado funcionan contra datos
reales del sitio, sigue siendo válido; los datos en sí se borraron.)*

**Por qué importa:** esto es lo que te va a dar visibilidad para decidir
cosas — por ejemplo, si mañana quieres "agrégale un campo para guardar la
foto en base64", ya sabemos exactamente dónde y cómo se agrega, porque el
modelo ya existe y ya tiene datos reales adentro.

## Fase 3 — Fotos del auto (CCTV) ✅ Prácticamente cerrada

Esta fase creció al confrontarla con la realidad, así que se partió en
pasos:

1. **Acceso a las cámaras** ✅ — confirmamos que sí podemos entrar al
   grabador (DVR) del sitio y pedirle una foto de cualquier cámara. Tiene
   5 cámaras activas, ya con nombres puestos ("Entrada Residentes",
   "Salida residentes", etc.).
2. **Confirmar cuál cámara es cuál puerta** ✅ — resultó que había una
   sexta cámara que no era de las 5 que vimos primero: es una cámara IP
   aparte (no de las analógicas del DVR), la de placas. Mapeo final:
   **entrada = 3 cámaras** (vista general, plumas de ingreso, y placas),
   **salida = 1 cámara** (vista general). La quinta cámara que parecía
   candidata a "salida" en realidad es de otro sistema (antenas RFID), no
   de morosos.
3. **Reusar código de otro proyecto tuyo** ✅ — adaptado y probado
   (contraseña ya no queda en el código, solo configuración segura).
4. **Post-mortem (fotos de eventos viejos) — se descartó** ❌ — se llegó a
   medir que el grabador solo guarda ~15-18 días (no las 6 semanas de
   nuestra base), y que 685 de los 1086 eventos guardados sí tenían video
   disponible. Pero se decidió **no perseguir ese video**: como no está
   confirmado que el reloj del teclado y el del DVR estuvieran
   sincronizados durante ese histórico, ni con video se podría garantizar
   que el auto salga en la foto a la hora correcta — mismo problema visto
   antes en el otro proyecto. No vale la pena invertir en descargar ~2045
   clips de valor dudoso.

   **Se recortó la base de datos a los 200 eventos más recientes** (de
   1086 a 200) — se prefiere quedarnos con menos datos pero confiables,
   que con el histórico completo cargando incertidumbre. El respaldo
   crudo original (`.zip`) se conserva por si sirve para otra cosa que no
   sea cruce con video.
5. **Fotos de eventos nuevos (en vivo)** ✅ — funcionando de verdad, no
   solo probado. Confirmamos que ni el video en vivo vale la pena (mismo
   problema técnico de reproducción que el video grabado). Ahora, cada vez
   que pasa un cruce real, el sistema automáticamente le pide al grabador
   una foto de las cámaras correspondientes **en ese instante** y la
   guarda junto al evento — ya no es un paso manual.
6. **Pantalla para ver esto** ✅ — visor web en `http://192.168.196.9:9200`,
   ya mostrando la foto real de cada evento (o "sin foto" si es de antes
   de activar esto, o si la puerta no tiene cámara configurada). Rediseño
   visual (2026-08-23) con la herramienta `/design` — le mostré 3
   direcciones, elegiste la clara con tarjetas de resumen, y ya quedó
   conectada a los datos reales (contador de eventos, placas leídas, sin
   lectura, todo en vivo).

## Fase 4 — Leer la placa automático ✅ Cerrada (automática + manual de respaldo)

**Hallazgo importante primero:** investigamos si se podía "no dejar pasar
si no se lee la placa" (tu idea, para el caso de luces prendidas o auto
sin placa). Confirmaste que la pluma **abre sola en cuanto el NIP es
válido** — nuestro sistema hoy solo se entera después, no tiene forma de
detenerla. Por ahora eso queda **fuera de alcance** (anotado para
investigar después, no descartado); Fase 4 se enfoca en **leer y
registrar la placa**, no en bloquear acceso.

**Qué se hizo:** ya tienes en otro proyecto (`lpr-caseta`) un sistema que
lee placas de la misma cámara, con semanas de ajuste real. En vez de
duplicar esos modelos (pesan varios GB) o depender de que ese sistema esté
corriendo, se armó un servicio propio aquí que reusa su instalación de
Python pero corre su propio código — así si algo le pasa al otro proyecto,
esto sigue funcionando. Ya está conectado: cada evento de entrada dispara
automático "¿qué dice la placa?" y lo guarda junto con la foto — ya visible
en el visor.

**Ya validado contra los 4 eventos reales que teníamos (2026-08-23):**

- **1 de 4 dio lectura** — placa `5ZN563` con 31% de confianza. Comparando
  a mano con la foto, la placa real es `57N-563` (confundió un 7 por una
  Z). El visor ya marca en naranja "⚠ dudosa" cuando la confianza baja de
  60%, para que sepas cuándo no confiar en el número tal cual.
- **3 de 4 sin lectura** — casi todos por lo que ya habías anticipado: las
  luces del auto encandilan tanto la cámara que ni la silueta se
  distingue bien. En el camino encontré y corregí 2 ajustes reales (umbral
  de confianza y un filtro contra "cajas basura" de fragmentos diminutos)
  al ver estos casos de verdad.
- **Ningún falso positivo con alta confianza** — cuando el sistema no está
  seguro, el número de confianza ya te avisa, no finge certeza.

**Sobre marca y modelo:** no, no se puede "ya de paso" — identificar marca
y modelo de un auto por foto es un modelo de visión distinto (entrenado
específicamente para eso), no algo que ya tengamos de `lpr-caseta` ni de
este pipeline. Si lo quieres, es trabajo aparte a evaluar — no algo que
esté ya resuelto y solo falte conectar.

**Respaldo cuando el OCR falla:** ya no se queda solo en "sin lectura" —
el visor de `apps/web` trae un campo para capturarla a mano cuando el
automático no pudo (mismo caso de las luces). Queda marcada como
`manual` en el listado, para diferenciarla de una lectura real.

## Fases que siguen (todavía no arrancan)

- **Padrón y patrones** — cruzar auto↔casa↔NIP, detectar mal uso.
- **Panel de administrador** — pantalla completa para autorizar/restringir
  y exportar evidencia.
- **Conexión con Vistara** — pasar el padrón de morosos detectados al
  sistema Vistara.

## Validado con datos reales (2026-08-22)

Ya cayó un cruce real y el sistema sacó su foto sola, sin que nadie lo
pidiera — funcionando en producción. Detectaste que la calidad venía baja
(704×480) — el grabador sí tiene mejor calidad disponible (1920×1080), solo
había que pedirla explícitamente. Ya corregido: de aquí en adelante todas
las fotos salen en resolución completa. (El evento que ya cayó se queda
con su foto de menor calidad — no tiene caso volver a tomarla, el auto ya
no está ahí.)

## Decisiones pendientes de tu parte ahora mismo

1. **Pruébalo tú en `http://192.168.196.9:3000`** — sobre todo el visor de
   fotos (clic en una fila/miniatura, flechas del teclado) y la captura
   manual de placa — avísame si algo no se ve o comporta bien.
2. **La idea de bloquear acceso sin placa válida** quedó anotada como
   pendiente de investigar (no descartada) — si quieres que investigue el
   modo de integración distinto que haría falta (vía `hccgw`), dímelo y le
   entro.
3. ¿Seguimos con **Fase 5** (padrón: qué auto(s) pertenecen a cada casa,
   detectar visitas coladas) ahora que la base (eventos + fotos + placa)
   ya está formal y en producción?
