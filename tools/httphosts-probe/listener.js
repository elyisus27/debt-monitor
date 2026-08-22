/**
 * httpHosts probe listener
 * -------------------------
 * Servidor HTTP minimo (cero dependencias) para capturar en crudo lo que
 * un teclado Hikvision manda cuando se le configura como listening server
 * via ISAPI (PUT/POST /ISAPI/Event/notification/httpHosts).
 *
 * Objetivo de esta primera fase: NO parsear nada todavia. Solo demostrar
 * que la conexion llega y guardar el request completo (headers + body
 * crudo) a disco, para poder inspeccionar el shape real del payload
 * (el manual ISAPI general no trae el schema detallado de
 * AccessControllerEvent - hay que verlo empiricamente).
 *
 * Uso:
 *   node listener.js [puerto]
 *   (puerto por defecto: 9099)
 *
 * Cada POST que llega se guarda en ./captures/<timestamp>.raw junto con
 * un .meta.json con method/url/headers, y responde 200 OK de inmediato
 * (el equipo espera una respuesta rapida).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 9099;
const CAPTURES_DIR = path.join(__dirname, 'captures');

if (!fs.existsSync(CAPTURES_DIR)) {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const slug = `${timestampSlug()}_${req.method}`;
    const rawPath = path.join(CAPTURES_DIR, `${slug}.raw`);
    const metaPath = path.join(CAPTURES_DIR, `${slug}.meta.json`);

    fs.writeFileSync(rawPath, body);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          method: req.method,
          url: req.url,
          headers: req.headers,
          bodyLength: body.length,
          receivedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url} - ${body.length} bytes -> ${path.basename(rawPath)}`
    );
    console.log(`  content-type: ${req.headers['content-type'] || '(none)'}`);

    // Responder rapido y neutro. Algunos firmwares esperan 200 simple.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`httpHosts probe listening on 0.0.0.0:${PORT}`);
  console.log(`Capturas en: ${CAPTURES_DIR}`);
  console.log('Esperando eventos... (Ctrl+C para salir)');
});
