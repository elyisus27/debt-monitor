// Lista de claves semanales del usuario de guardias (ver weekly-code.ts), para que el
// dueño la guarde en su Drive y la dicte por teléfono cuando se cae el internet.
//
//   pnpm claves              -> este año y los 4 siguientes, CSV
//   pnpm claves 2026 2030    -> de 2026 a 2030
//
// Usa CONTINGENCIA_MASTER_KEY del entorno o de apps/api/.env -- tiene que ser la MISMA
// que está en el .env de la PC de caseta, si no las claves no van a coincidir.
import { claveSemanal, semanasDelAnio } from './weekly-code';

try {
  process.loadEnvFile('.env');
} catch {
  // sin .env: solo variables de entorno
}

const masterKey = process.env.CONTINGENCIA_MASTER_KEY;
if (!masterKey) {
  console.error('Falta CONTINGENCIA_MASTER_KEY (en el entorno o en apps/api/.env)');
  process.exit(1);
}

const actual = new Date().getFullYear();
const desde = Number(process.argv[2]) || actual;
const hasta = Number(process.argv[3]) || desde + 4;

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Fecha en texto ("lun 28 sep 2026"): al importar el CSV a Sheets no se reinterpreta
// como fecha (ni se voltea a mm/dd).
function fecha(d: Date): string {
  return `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

// "482 915": se dicta mejor y Sheets no lo convierte en número (perdería ceros a la
// izquierda). El login ignora los espacios.
function agrupar(clave: string): string {
  return `${clave.slice(0, 3)} ${clave.slice(3)}`;
}

console.log('Semana,Del,Al,Clave');
for (let year = desde; year <= hasta; year++) {
  for (const s of semanasDelAnio(year)) {
    const domingo = new Date(s.monday.getFullYear(), s.monday.getMonth(), s.monday.getDate() + 6);
    console.log(`${s.key},${fecha(s.monday)},${fecha(domingo)},${agrupar(claveSemanal(masterKey, s.key))}`);
  }
}
