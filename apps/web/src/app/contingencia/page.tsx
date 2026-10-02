'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './page.module.css';
import { FormularioEntrada } from '../../components/contingencia/FormularioEntrada';
import {
  ErrorApi,
  VISIT_TYPE_LABELS,
  actualizarDirectorio,
  aperturaEmergencia,
  guardarSesion,
  iniciarSesion,
  leerSesion,
  listarVisitas,
  obtenerDirectorio,
  obtenerEstado,
  type Domicilio,
  type Estado,
  type Sesion,
  type VisitaContingencia,
} from '../../lib/contingencia';

// Directorio más viejo que esto se marca en ámbar: los teléfonos pueden ya no servir.
const DIRECTORIO_VIEJO_MS = 48 * 3600_000;

function fechaHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hace(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 60) return `hace ${Math.max(min, 0)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Contingencia() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [listo, setListo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setSesion(leerSesion());
    setListo(true);
  }, []);

  const salir = useCallback((motivo?: string) => {
    guardarSesion(null);
    setSesion(null);
    setAviso(motivo ?? null);
  }, []);

  if (!listo) return null;
  if (!sesion) {
    return (
      <Login
        aviso={aviso}
        onEntrar={(s) => {
          guardarSesion(s);
          setSesion(s);
        }}
      />
    );
  }
  return <Bitacora sesion={sesion} onSalir={salir} />;
}

function Login({ aviso, onEntrar }: { aviso: string | null; onEntrar: (s: Sesion) => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      onEntrar(await iniciarSesion(usuario, clave));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className={styles.login}>
      <form className={`card ${styles.loginCaja}`} onSubmit={entrar}>
        <div>
          <div className={styles.kicker}>Caseta · sin internet</div>
          <h1 className={styles.titulo}>Bitácora de contingencia</h1>
        </div>
        {aviso && <p className={styles.textoAviso}>{aviso}</p>}
        <div className="field">
          <label htmlFor="usuario">Usuario</label>
          <input
            id="usuario"
            className="input"
            autoComplete="username"
            autoFocus
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="clave">Contraseña</label>
          <input
            id="clave"
            className="input"
            type="password"
            autoComplete="current-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            required
          />
        </div>
        {error && <p className={styles.textoError}>{error}</p>}
        <button type="submit" className={styles.botonPrincipal} disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

function Bitacora({ sesion, onSalir }: { sesion: Sesion; onSalir: (motivo?: string) => void }) {
  const token = sesion.token;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [directorio, setDirectorio] = useState<Domicilio[]>([]);
  const [formAbierto, setFormAbierto] = useState(false);
  const [refresco, setRefresco] = useState(0);
  const [actualizandoDir, setActualizandoDir] = useState(false);
  const [avisoDir, setAvisoDir] = useState<string | null>(null);
  const [emergencia, setEmergencia] = useState(false);

  // Cualquier 401 (sesión vencida, clave rotada + reinicio) regresa al login.
  const manejarError = useCallback(
    (err: unknown) => {
      if (err instanceof ErrorApi && err.status === 401) onSalir(err.message);
      else console.error(err);
    },
    [onSalir],
  );

  const cargarEstado = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([obtenerEstado(token), obtenerDirectorio(token)]);
      setEstado(e);
      setDirectorio(d);
    } catch (err) {
      manejarError(err);
    }
  }, [token, manejarError]);

  // Cada minuto: refresca la hora del equipo y, al cambiar la semana, el 401 del
  // usuario de guardias lo regresa al login aunque no esté tocando nada.
  useEffect(() => {
    cargarEstado();
    const t = setInterval(() => {
      obtenerEstado(token).then(setEstado).catch(manejarError);
    }, 60_000);
    return () => clearInterval(t);
  }, [cargarEstado, token, manejarError]);

  async function refrescarDirectorio() {
    setActualizandoDir(true);
    setAvisoDir(null);
    try {
      const r = await actualizarDirectorio(token);
      setAvisoDir(r.ok ? `Directorio actualizado: ${r.units} domicilios` : `No se pudo actualizar: ${r.error}`);
      await cargarEstado();
    } catch (err) {
      manejarError(err);
    } finally {
      setActualizandoDir(false);
    }
  }

  const cerrarFormulario = useCallback(() => setFormAbierto(false), []);
  const registrada = useCallback(() => setRefresco((n) => n + 1), []);

  const dir = estado?.directory;
  const dirViejo = !dir?.syncedAt || Date.now() - Date.parse(dir.syncedAt) > DIRECTORIO_VIEJO_MS;

  return (
    <main className={styles.pagina}>
      <header className={styles.encabezado}>
        <div>
          <div className={styles.kicker}>Caseta · sin internet</div>
          <h1 className={styles.titulo}>Bitácora de contingencia</h1>
        </div>
        <div className={styles.encabezadoDer}>
          <span>
            Usuario <strong>{sesion.username}</strong>
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => onSalir()}>
            Salir
          </button>
        </div>
      </header>

      <section className={`${styles.estado} ${dirViejo ? styles.estadoViejo : ''}`}>
        <span>
          {dir?.syncedAt
            ? `Directorio de domicilios: ${dir.units} domicilios, actualizado ${hace(dir.syncedAt)} (${fechaHora(dir.syncedAt)})`
            : 'El directorio de domicilios nunca se ha descargado — el domicilio se captura a mano'}
          {dirViejo && dir?.syncedAt ? ' — los teléfonos pueden estar desactualizados' : ''}
        </span>
        <button type="button" className="btn btn-ghost" onClick={refrescarDirectorio} disabled={actualizandoDir}>
          {actualizandoDir ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
        {avisoDir && <span className="text-muted">{avisoDir}</span>}
        {estado && (
          <span className="text-muted">
            Semana {estado.semana.replace('-W', ' · ')} · hora del equipo {fechaHora(estado.serverTime)}
          </span>
        )}
        {estado && !estado.totemConfigured && (
          <span className={styles.textoError}>La pluma no está configurada en este equipo (TOTEM_GPIO_URL)</span>
        )}
      </section>

      <div className={styles.acciones}>
        <button type="button" className={styles.botonPrincipal} onClick={() => setFormAbierto(true)}>
          Registrar entrada
        </button>
        <button type="button" className={styles.botonEmergencia} onClick={() => setEmergencia(true)}>
          Apertura emergencia (ambulancia, bomberos)
        </button>
      </div>

      <h2 className={styles.subtitulo}>Entradas registradas</h2>
      <Historico token={token} refresco={refresco} onError={manejarError} />

      {formAbierto && (
        <FormularioEntrada
          token={token}
          directorio={directorio}
          onCerrar={cerrarFormulario}
          onRegistrada={registrada}
        />
      )}

      {emergencia && (
        <ConfirmarEmergencia
          token={token}
          onCerrar={() => setEmergencia(false)}
          onAbierta={registrada}
          onError={manejarError}
        />
      )}
    </main>
  );
}

function Historico({ token, refresco, onError }: { token: string; refresco: number; onError: (e: unknown) => void }) {
  const [fecha, setFecha] = useState(hoyLocal);
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ visitas: VisitaContingencia[]; total: number; totalPages: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelado = false;
    listarVisitas(token, { fecha, q, page: pagina })
      .then((r) => !cancelado && setDatos(r))
      .catch(onError);
    return () => {
      cancelado = true;
    };
  }, [token, fecha, q, pagina, refresco, onError]);

  return (
    <div className={styles.columna}>
      <div className={styles.filtros}>
        <div className="field">
          <label htmlFor="fecha">Día</label>
          <input
            id="fecha"
            className="input"
            type="date"
            value={fecha}
            onChange={(e) => {
              setFecha(e.target.value);
              setPagina(1);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="buscar">Buscar</label>
          <input
            id="buscar"
            className="input"
            placeholder="Nombre, placa o domicilio"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPagina(1);
            }}
          />
        </div>
        <span className="text-muted">{datos ? `${datos.total} registro(s)` : '…'}</span>
      </div>
      {datos && datos.visitas.length > 0 ? (
        <TablaVisitas visitas={datos.visitas} />
      ) : (
        <p className="text-muted">Sin registros.</p>
      )}
      {datos && datos.totalPages > 1 && (
        <div className={styles.paginacion}>
          <button type="button" className="btn btn-secondary" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </button>
          <span>
            Página {pagina} de {datos.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pagina >= datos.totalPages}
            onClick={() => setPagina(pagina + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

function TablaVisitas({ visitas }: { visitas: VisitaContingencia[] }) {
  return (
    <div className={styles.tablaCaja}>
      <table className={styles.tabla}>
        <thead>
          <tr>
            <th>Entrada</th>
            <th>Domicilio</th>
            <th>Visitante</th>
            <th>Tipo</th>
            <th>Placa</th>
            <th>Se avisó a</th>
            <th>Aperturas</th>
            <th>Registró</th>
            <th>Vistara</th>
          </tr>
        </thead>
        <tbody>
          {visitas.map((v) => (
            <tr key={v.id}>
              <td>{fechaHora(v.enteredAt)}</td>
              <td className="mono">{v.domicileCode}</td>
              <td>
                {v.visitorName}
                {v.notes && <div className="text-muted">{v.notes}</div>}
              </td>
              <td>
                {VISIT_TYPE_LABELS[v.visitType] ?? v.visitType}
                {v.accessType === 'PEDESTRIAN' && <span className="text-muted"> · peatonal</span>}
              </td>
              <td className="mono">{v.plate ?? '—'}</td>
              <td>{v.residentName ?? '—'}</td>
              <td>
                {!v._count?.barrierOpens ? '—' : v._count.barrierOpens === 1 ? '1 vez' : `${v._count.barrierOpens} veces`}
              </td>
              <td>{v.registeredBy}</td>
              <td>{v.vistaraStatus === 'sent' ? 'Sincronizada' : 'Pendiente'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmarEmergencia({
  token,
  onCerrar,
  onAbierta,
  onError,
}: {
  token: string;
  onCerrar: () => void;
  onAbierta: () => void;
  onError: (e: unknown) => void;
}) {
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setEnviando(true);
    setError(null);
    try {
      const r = await aperturaEmergencia(token, notas);
      if (!r.opened) {
        setError(r.error ?? 'La pluma no respondió');
        return;
      }
      onAbierta();
      onCerrar();
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : 'No se pudo enviar la orden');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.fondo} role="dialog" aria-modal="true">
      <div className={`${styles.panel} ${styles.panelChico}`}>
        <h2>¿Abrir la pluma por emergencia?</h2>
        <p className="text-muted">
          Solo para ambulancia o bomberos. Se abre sin registro previo y queda registrada como emergencia a
          Administración, con tu usuario.
        </p>
        <div className="field">
          <label htmlFor="notas-emergencia">Notas (opcional)</label>
          <textarea
            id="notas-emergencia"
            className="input"
            rows={2}
            placeholder="Ej. ambulancia Cruz Roja a 972-05"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>
        {error && <p className={styles.textoError}>{error}</p>}
        <div className={styles.acciones}>
          <button type="button" className={styles.botonEmergencia} onClick={abrir} disabled={enviando}>
            {enviando ? 'Abriendo…' : 'Sí, abrir ahora'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
