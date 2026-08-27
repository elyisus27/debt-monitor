#!/usr/bin/env node
/**
 * normalizar-placas.js
 * ---------------------
 * Migración de datos, corrida una sola vez (2026-08-27): quita los guiones
 * de plate_text en access_events ("ABC-123-D" -> "ABC123D") para que quede
 * en el mismo formato que ahora produce tools/plate-reader/plate_ocr.py y
 * que valida normalizarPlaca() (apps/api/src/plate/normalizar-placa.ts) --
 * ver esos dos archivos para el porqué del cambio.
 *
 * Segura de re-correr: solo toca filas donde plate_text todavía tiene un
 * caracter fuera de [A-Z0-9], así que si ya se corrió no hace nada.
 *
 * Uso: node apps/api/scripts/normalizar-placas.js [--db=ruta/a/dev.db]
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const argDb = process.argv.find((a) => a.startsWith('--db='));
const dbPath = argDb ? argDb.slice('--db='.length) : path.join(__dirname, '..', 'prisma', 'dev.db');

const db = new DatabaseSync(dbPath);

const pendientes = db
  .prepare("SELECT id, plate_text FROM access_events WHERE plate_text IS NOT NULL AND plate_text GLOB '*[^A-Z0-9]*'")
  .all();

console.log(`${dbPath}: ${pendientes.length} fila(s) con guiones/espacios en plate_text.`);

if (pendientes.length === 0) {
  console.log('Nada que migrar.');
  process.exit(0);
}

const update = db.prepare('UPDATE access_events SET plate_text = ? WHERE id = ?');

db.exec('BEGIN');
try {
  for (const row of pendientes) {
    const normalizada = row.plate_text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    update.run(normalizada, row.id);
    console.log(`  #${row.id}: "${row.plate_text}" -> "${normalizada}"`);
  }
  db.exec('COMMIT');
  console.log(`Listo -- ${pendientes.length} fila(s) normalizada(s).`);
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
} finally {
  db.close();
}
