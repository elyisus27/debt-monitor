'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from '../../app/contingencia/page.module.css';
import {
  ROLE_LABELS,
  STOP_COUNT_TYPES,
  VISIT_TYPES_FORM,
  VISIT_TYPE_LABELS,
  abrirPluma,
  registrarVisita,
  type Domicilio,
  type NuevaVisita,
  type VisitaContingencia,
} from '../../lib/contingencia';

// Tras usar "Abrir barrera" una vez, el panel se cierra solo tras 2 min sin tocarlo
// -- igual que Vistara (BARRIER_PANEL_IDLE_MS): si se queda abierto, el siguiente
// vehículo terminaría entrando con "insistir" sobre el registro anterior.
const PANEL_IDLE_MS = 2 * 60 * 1000;

const FORM_VACIO: NuevaVisita = {
  visitorName: '',
  visitType: 'VISIT',
  accessType: 'VEHICLE',
  plate: '',
  notes: '',
  stopCount: '',
};

// Misma normalización de domicilio que Vistara (por segmentos, sin ceros a la
// izquierda): "972-5", "972 05" y "972-05" son el mismo domicilio.
function normalizar(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? String(parseInt(seg, 10)) : seg))
    .join('-');
}

type EstadoPluma = 'idle' | 'sending' | 'sent' | 'error';

export function FormularioEntrada({
  token,
  directorio,
  onCerrar,
  onRegistrada,
}: {
  token: string;
  directorio: Domicilio[];
  onCerrar: () => void;
  onRegistrada: () => void;
}) {
  const [form, setForm] = useState<NuevaVisita>(FORM_VACIO);
  const [busquedaDomicilio, setBusquedaDomicilio] = useState('');
  const [domicilio, setDomicilio] = useState<Domicilio | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [registrada, setRegistrada] = useState<VisitaContingencia | null>(null);
  const [pluma, setPluma] = useState<EstadoPluma>('idle');
  const [plumaError, setPlumaError] = useState<string | null>(null);
  const [plumaUsada, setPlumaUsada] = useState(false);
  const [actividad, setActividad] = useState(0);

  const sinDirectorio = directorio.length === 0;

  const sugerencias = useMemo(() => {
    const q = normalizar(busquedaDomicilio);
    if (!q || domicilio) return [];
    const crudo = busquedaDomicilio.trim().toUpperCase();
    return directorio
      .filter((d) => normalizar(d.label).startsWith(q) || d.label.toUpperCase().includes(crudo))
      .slice(0, 8);
  }, [busquedaDomicilio, directorio, domicilio]);

  useEffect(() => {
    if (!registrada || !plumaUsada) return;
    const t = setTimeout(onCerrar, PANEL_IDLE_MS);
    return () => clearTimeout(t);
  }, [registrada, plumaUsada, actividad, onCerrar]);

  function cambiar<K extends keyof NuevaVisita>(campo: K, valor: NuevaVisita[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function elegirDomicilio(d: Domicilio) {
    setDomicilio(d);
    setBusquedaDomicilio(d.label);
    // Si solo hay un residente, se preselecciona (a quien se le avisa).
    cambiar('residentId', d.residents.length === 1 ? d.residents[0].id : undefined);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    if (!sinDirectorio && !domicilio) {
      setError('Elige el domicilio de la lista');
      return;
    }
    setGuardando(true);
    try {
      const visita = await registrarVisita(token, {
        ...form,
        unitId: domicilio?.id,
        domicileCode: sinDirectorio ? busquedaDomicilio : undefined,
        plate: form.accessType === 'VEHICLE' ? form.plate : undefined,
        stopCount: STOP_COUNT_TYPES.has(form.visitType) ? form.stopCount : undefined,
      });
      setRegistrada(visita);
      onRegistrada();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar');
    } finally {
      setGuardando(false);
    }
  }

  // Se puede insistir cuantas veces haga falta para ESTA visita; solo se evita el
  // doble envío mientras una petición está en vuelo.
  async function abrir() {
    if (!registrada || pluma === 'sending') return;
    setPlumaUsada(true);
    setPluma('sending');
    setPlumaError(null);
    try {
      const r = await abrirPluma(token, registrada.id);
      setPluma(r.opened ? 'sent' : 'error');
      if (!r.opened) setPlumaError(r.error ?? 'La pluma no respondió');
    } catch (err) {
      setPluma('error');
      setPlumaError(err instanceof Error ? err.message : 'No se pudo enviar la orden');
    }
  }

  function nuevaEntrada() {
    setForm(FORM_VACIO);
    setBusquedaDomicilio('');
    setDomicilio(null);
    setRegistrada(null);
    setPluma('idle');
    setPlumaError(null);
    setPlumaUsada(false);
    setError(null);
  }

  const residenteAvisado = registrada && domicilio?.residents.find((r) => r.id === registrada.residentId);

  return (
    <div className={styles.fondo} role="dialog" aria-modal="true">
      <div
        className={styles.panel}
        onPointerDown={() => plumaUsada && setActividad((n) => n + 1)}
        onKeyDown={() => plumaUsada && setActividad((n) => n + 1)}
      >
        <div className={styles.panelEncabezado}>
          <h2>{registrada ? 'Visita registrada' : 'Registrar entrada'}</h2>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        {registrada ? (
          <div className={styles.columna}>
            <div className={styles.avisoOk}>
              Visita registrada — <strong>{registrada.visitorName}</strong> para {registrada.domicileCode}
            </div>

            <button
              type="button"
              onClick={abrir}
              disabled={pluma === 'sending'}
              className={`${styles.botonPluma} ${pluma === 'sent' ? styles.botonPlumaOk : ''} ${pluma === 'error' ? styles.botonPlumaError : ''}`}
            >
              {pluma === 'sending'
                ? 'Abriendo…'
                : pluma === 'sent'
                  ? 'Barrera abierta — insistir'
                  : pluma === 'error'
                    ? 'No abrió — reintentar'
                    : 'Abrir barrera'}
            </button>
            {plumaError && <p className={styles.textoError}>{plumaError}</p>}

            {domicilio && domicilio.residents.length > 0 && (
              <div className={styles.contactos}>
                <div className={styles.etiqueta}>Contactos del domicilio</div>
                {(residenteAvisado ? [residenteAvisado] : domicilio.residents).map((r) => (
                  <div key={r.id} className={styles.contacto}>
                    <div>
                      <strong>{r.name}</strong> <span className="text-muted">{ROLE_LABELS[r.role] ?? r.role}</span>
                    </div>
                    {[r.phone, r.phoneHome, r.phoneSecondary].filter(Boolean).map((tel) => (
                      <a key={tel} href={`tel:${tel}`} className="mono">
                        {tel}
                      </a>
                    ))}
                    {!r.phone && !r.phoneHome && !r.phoneSecondary && <span className="text-muted">Sin teléfono</span>}
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="btn btn-secondary" onClick={nuevaEntrada}>
              Nueva entrada
            </button>
          </div>
        ) : (
          <form className={styles.columna} onSubmit={guardar}>
            <div className="field">
              <label htmlFor="domicilio">Domicilio</label>
              <input
                id="domicilio"
                className="input"
                autoComplete="off"
                autoFocus
                placeholder={sinDirectorio ? 'Ej. 972-05' : 'Escribe para buscar, ej. 972-05'}
                value={busquedaDomicilio}
                onChange={(e) => {
                  setBusquedaDomicilio(e.target.value);
                  setDomicilio(null);
                  cambiar('residentId', undefined);
                }}
              />
              {sugerencias.length > 0 && (
                <ul className={styles.sugerencias}>
                  {sugerencias.map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={() => elegirDomicilio(d)}>
                        <span className="mono">{d.label}</span>
                        {d.isDelinquent && <span className={styles.tagMoroso}>Adeudo</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {domicilio?.isDelinquent && (
                <p className={styles.textoAviso}>Este domicilio tiene adeudo vencido en Vistara.</p>
              )}
            </div>

            {domicilio && domicilio.residents.length > 0 && (
              <div className="field">
                <label htmlFor="residente">Se avisa a</label>
                <select
                  id="residente"
                  className="input"
                  value={form.residentId ?? ''}
                  onChange={(e) => cambiar('residentId', e.target.value || undefined)}
                >
                  <option value="">— Sin especificar —</option>
                  {domicilio.residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {ROLE_LABELS[r.role] ?? r.role}
                      {r.phone ? ` · ${r.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label htmlFor="visitante">Nombre del visitante</label>
              <input
                id="visitante"
                className="input"
                placeholder="Juan Pérez"
                value={form.visitorName}
                onChange={(e) => cambiar('visitorName', e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="tipo">Tipo de visita</label>
              <select
                id="tipo"
                className="input"
                value={form.visitType}
                onChange={(e) => cambiar('visitType', e.target.value)}
              >
                {VISIT_TYPES_FORM.map((t) => (
                  <option key={t} value={t}>
                    {VISIT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Acceso</label>
              <div className="seg">
                <button
                  type="button"
                  className="seg-opt"
                  aria-pressed={form.accessType === 'VEHICLE'}
                  onClick={() => cambiar('accessType', 'VEHICLE')}
                >
                  Vehicular
                </button>
                <button
                  type="button"
                  className="seg-opt"
                  aria-pressed={form.accessType === 'PEDESTRIAN'}
                  onClick={() => cambiar('accessType', 'PEDESTRIAN')}
                >
                  Peatonal
                </button>
              </div>
            </div>

            {form.accessType === 'VEHICLE' && (
              <div className="field">
                <label htmlFor="placa">Placa</label>
                <input
                  id="placa"
                  className="input mono"
                  placeholder="ABC1234"
                  value={form.plate}
                  onChange={(e) => cambiar('plate', e.target.value.toUpperCase())}
                />
              </div>
            )}

            {STOP_COUNT_TYPES.has(form.visitType) && (
              <div className="field">
                <label htmlFor="paradas">Paradas</label>
                <input
                  id="paradas"
                  className="input"
                  type="number"
                  min={1}
                  max={99}
                  placeholder="¿Cuántas entregas trae?"
                  value={form.stopCount}
                  onChange={(e) => cambiar('stopCount', e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="notas">Notas</label>
              <textarea
                id="notas"
                className="input"
                rows={2}
                placeholder="Observaciones adicionales…"
                value={form.notes}
                onChange={(e) => cambiar('notes', e.target.value)}
              />
            </div>

            {error && <p className={styles.textoError}>{error}</p>}

            <button type="submit" className={styles.botonPrincipal} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Registrar entrada'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
