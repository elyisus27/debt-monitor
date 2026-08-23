'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { FilterBar } from '../components/FilterBar';
import { KpiGrid } from '../components/KpiGrid';
import { EventsTable } from '../components/EventsTable';
import { Viewer } from '../components/Viewer';
import { obtenerCruces, obtenerResumen, obtenerUltimoCruce, capturarPlacaManual } from '../lib/api';
import { rangoMesActual, tiempoRelativo } from '../lib/dates';
import { construirSecuenciaPlana, moverEnSecuencia, posicionTexto, type PosicionPlana } from '../lib/flatSequence';
import type { Evento, Resumen, Filtros } from '../lib/types';

const UMBRAL_CONFIANZA = 80;
const POLL_MS = 4000; // ingesta en vivo: no hay WebSocket/SSE, se hace por polling simple

function elementoEsCampo(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

export default function Pagina() {
  const [filtros, setFiltros] = useState<Filtros>(() => ({
    ...rangoMesActual(),
    q: '',
    dispositivo: 'Todos',
    sentido: 'todos',
    lectura: 'todas',
  }));
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [total, setTotal] = useState(0);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);

  const [sel, setSel] = useState(0);
  const [visorPos, setVisorPos] = useState<PosicionPlana | null>(null);
  const [ultimoCruce, setUltimoCruce] = useState<Evento | null>(null);
  const [, setTick] = useState(0); // fuerza re-render cada 1s para refrescar "hace Xs"

  const cargar = useCallback(async (f: Filtros) => {
    setCargando(true);
    try {
      const [listaRes, resumenRes] = await Promise.all([obtenerCruces(f), obtenerResumen(f)]);
      setEventos(listaRes.eventos);
      setTotal(listaRes.total);
      setResumen(resumenRes);
    } catch (err) {
      console.error('Error cargando cruces:', err);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(filtros);
  }, [filtros, cargar]);

  // Referencias siempre-actuales para el listener de teclado (evita re-registrar
  // el listener en cada render y evita closures viejos sobre `eventos`/`visorPos`).
  const eventosRef = useRef(eventos);
  eventosRef.current = eventos;
  const visorPosRef = useRef(visorPos);
  visorPosRef.current = visorPos;
  const selRef = useRef(sel);
  selRef.current = sel;

  const abrirEvento = useCallback((ev: Evento, fotoIndex: number) => {
    setVisorPos({ eventoId: ev.id, fotoIndex });
  }, []);

  const guardarPlacaManual = useCallback(async (placa: string) => {
    const pos = visorPosRef.current;
    if (!pos) return;
    const actualizado = await capturarPlacaManual(pos.eventoId, placa);
    setEventos((prev) => prev.map((e) => (e.id === actualizado.id ? actualizado : e)));
    setResumen((r) =>
      r ? { ...r, placasLeidas: r.placasLeidas + 1, placasNoLeidas: r.placasNoLeidas - 1 } : r,
    );
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (visorPosRef.current) setVisorPos(null);
        return;
      }
      if (elementoEsCampo(document.activeElement)) return; // solo Esc funciona con foco en un campo

      const evs = eventosRef.current;

      if (visorPosRef.current) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const seq = construirSecuenciaPlana(evs);
          setVisorPos(moverEnSecuencia(seq, visorPosRef.current, e.key === 'ArrowLeft' ? -1 : 1));
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(evs.length - 1, s + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === 'Enter') {
        const ev = evs[selRef.current];
        if (ev) abrirEvento(ev, 0);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abrirEvento]);

  // Ingesta en vivo: sin WebSocket/SSE, se pregunta cada POLL_MS por el evento más
  // reciente (sin filtrar). Si cambió, se refresca el panel + el listado/KPIs
  // filtrados -- sin flash, React solo re-renderiza con datos nuevos. La posición
  // del visor (si está abierto) se resuelve por id, no por índice: al refrescar
  // `eventos`, `eventoAbierto` se recalcula por id y sigue apuntando al mismo
  // evento aunque el listado haya cambiado de tamaño/orden arriba.
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;

  useEffect(() => {
    let cancelado = false;
    async function poll() {
      try {
        const ultimo = await obtenerUltimoCruce();
        if (cancelado) return;
        setUltimoCruce((actual) => {
          if (ultimo && ultimo.id !== actual?.id) {
            cargar(filtrosRef.current); // hay evento nuevo de verdad -- refresca listado+KPIs
            return ultimo;
          }
          return actual ?? ultimo;
        });
      } catch (err) {
        console.error('Error en polling de último cruce:', err);
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [cargar]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const seq = construirSecuenciaPlana(eventos);
  const eventoAbierto = visorPos ? eventos.find((e) => e.id === visorPos.eventoId) : undefined;

  return (
    <main className={styles.pagina}>
      <header className={styles.encabezado}>
        <div>
          <div className={styles.kicker}>Control de acceso · Hikvision ANPR</div>
          <h1 className={styles.titulo}>Cruces de caseta</h1>
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          <Link
            href="/"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-accent)',
              background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
              padding: '6px 12px',
              borderRadius: 6,
            }}
          >
            Cruces
          </Link>
          <Link
            href="/estadisticas"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-500)', padding: '6px 12px', borderRadius: 6 }}
          >
            Estadísticas
          </Link>
        </nav>
        <div className={styles.encabezadoDer}>
          <span className={styles.punto} />
          en vivo
          {ultimoCruce && (
            <>
              <span>·</span>
              <span>último cruce {tiempoRelativo(ultimoCruce.timestamp)}</span>
            </>
          )}
        </div>
      </header>

      <FilterBar filtros={filtros} onChange={setFiltros} />

      <KpiGrid resumen={resumen} onCapturarPendientes={(p) => setFiltros((f) => ({ ...f, ...p }))} />

      <EventsTable
        eventos={eventos}
        total={total}
        desde={filtros.desde}
        hasta={filtros.hasta}
        umbral={UMBRAL_CONFIANZA}
        cargando={cargando}
        selIndex={visorPos ? undefined : sel}
        onAbrirEvento={(ev, i) => {
          setSel(eventos.findIndex((e) => e.id === ev.id));
          abrirEvento(ev, i);
        }}
        onCapturarSinLectura={(ev) => {
          const idxPlaca = ev.fotos.findIndex((f) => f.etiqueta === 'Placas');
          abrirEvento(ev, idxPlaca >= 0 ? idxPlaca : 0);
        }}
      />

      {eventoAbierto && visorPos && (
        <Viewer
          evento={eventoAbierto}
          fotoIndex={visorPos.fotoIndex}
          posicionTexto={posicionTexto(seq, visorPos, total)}
          hasPrev={seq.findIndex((p) => p.eventoId === visorPos.eventoId && p.fotoIndex === visorPos.fotoIndex) > 0}
          hasNext={
            seq.findIndex((p) => p.eventoId === visorPos.eventoId && p.fotoIndex === visorPos.fotoIndex) <
            seq.length - 1
          }
          onPrev={() => setVisorPos(moverEnSecuencia(seq, visorPos, -1))}
          onNext={() => setVisorPos(moverEnSecuencia(seq, visorPos, 1))}
          onClose={() => setVisorPos(null)}
          onSeleccionarFoto={(i) => setVisorPos({ eventoId: visorPos.eventoId, fotoIndex: i })}
          onGuardarPlaca={guardarPlacaManual}
        />
      )}
    </main>
  );
}
