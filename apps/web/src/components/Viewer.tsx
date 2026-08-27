'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../app/page.module.css';
import type { Evento } from '../lib/types';
import { formatFechaHora } from '../lib/dates';

interface Props {
  evento: Evento;
  fotoIndex: number;
  posicionTexto: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSeleccionarFoto: (i: number) => void;
  onGuardarPlaca: (placa: string) => Promise<void>;
}

export function Viewer({
  evento,
  fotoIndex,
  posicionTexto,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onSeleccionarFoto,
  onGuardarPlaca,
}: Props) {
  const [captura, setCaptura] = useState('');
  const [guardando, setGuardando] = useState(false);
  // Flujo a 2 pasos a propósito: clic en "Capturar" ANTES de que el input
  // tome foco. Con autoFocus inmediato, abrir el visor en un evento sin
  // placa metía el foco al input de una y las flechas ←/→ dejaban de
  // navegar (el listener global las ignora con foco en un campo) -- justo
  // cuando más se quieren usar, para pasar rápido entre fotos/eventos.
  const [capturando, setCapturando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Zoom: clic en la foto acerca 2.4x centrado en el punto donde se dio
  // clic (útil para leer una placa chica); clic de nuevo regresa a normal.
  const [zoom, setZoom] = useState(false);
  const [zoomOrigen, setZoomOrigen] = useState('50% 50%');

  const foto = evento.fotos[fotoIndex];
  const { hora, fecha } = formatFechaHora(evento.timestamp);
  const sinLectura = !evento.placa;

  // Salir de "modo captura" y de zoom al cambiar de foto -- pero el
  // disparador (botón/editor) en sí se queda SIEMPRE en el mismo lugar en
  // las 3 fotos del evento (antes solo salía en la de Placas, y aparecer/
  // desaparecer movía el layout al cambiar de foto -- inconsistente).
  useEffect(() => {
    setCapturando(false);
    setZoom(false);
  }, [fotoIndex]);

  // Al cambiar de EVENTO sí se resetea el texto -- no arrastrar lo que se
  // estaba escribiendo para un cruce distinto.
  useEffect(() => {
    setCaptura('');
    setCapturando(false);
  }, [evento.id]);

  const clicEnFoto = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomOrigen(`${x}% ${y}%`);
    setZoom((z) => !z);
  };

  useEffect(() => {
    if (capturando) inputRef.current?.focus();
  }, [capturando]);

  const empezarEdicion = () => {
    setCaptura(evento.placa ?? ''); // editar una ya puesta parte de su valor actual, no en blanco
    setCapturando(true);
  };

  const guardar = async () => {
    if (!captura.trim() || guardando) return;
    setGuardando(true);
    try {
      await onGuardarPlaca(captura.trim());
      setCapturando(false);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className={styles.visorBackdrop} onClick={onClose}>
      <div className={styles.visorPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.visorCabecera}>
          <span className={`${styles.visorPlaca} ${sinLectura ? styles.visorPlacaAlerta : ''}`}>
            {evento.placa ?? 'SIN LECTURA'}
          </span>
          <span className="tag tag-accent">Casa {evento.casa}</span>
          <span className={styles.visorMeta}>
            {evento.sentido === 'entrada' ? 'Entrada' : 'Salida'} · {fecha} {hora}
          </span>
          <span className={`${styles.visorMeta} mono`}>
            {evento.manual ? 'manual' : evento.confianza !== null ? `OCR ${evento.confianza}%` : ''}
          </span>
          <button type="button" className={`btn btn-secondary ${styles.visorCerrar}`} onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className={styles.visorCuerpo}>
          <button type="button" className={styles.visorFlecha} onClick={onPrev} disabled={!hasPrev} aria-label="Anterior">
            ←
          </button>

          <div className={styles.visorMarco}>
            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={foto.url}
                alt={foto.etiqueta}
                className={zoom ? styles.zoom : ''}
                style={{ transformOrigin: zoomOrigen }}
                onClick={clicEnFoto}
              />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--color-neutral-600)' }}>
                Sin foto
              </div>
            )}
            <div className={styles.visorMarcoBarra}>
              <span>{evento.dispositivo}</span>
              <span>
                {fecha} {hora}
              </span>
            </div>
          </div>

          <button type="button" className={styles.visorFlecha} onClick={onNext} disabled={!hasNext} aria-label="Siguiente">
            →
          </button>
        </div>

        <div className={styles.visorPie}>
          <div className={styles.filmTira}>
            {evento.fotos.map((f, i) => (
              <button
                key={f.canal}
                type="button"
                className={`${styles.filmMini} ${i === fotoIndex ? styles.filmMiniActiva : ''}`}
                onClick={() => onSeleccionarFoto(i)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={f.etiqueta} />
              </button>
            ))}
          </div>
          <span className={styles.visorPista}>← más reciente · → más antiguo · Esc cerrar</span>
          <span className={styles.visorPosicion}>{posicionTexto}</span>
        </div>

        <div className={styles.editorPlaca}>
          {capturando ? (
            <div className={styles.editorFila}>
              <input
                ref={inputRef}
                type="text"
                className={`input ${styles.editorInput}`}
                placeholder="ABC1234"
                value={captura}
                onChange={(e) => setCaptura(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') guardar();
                  // Esc: el listener global del visor ya lo cierra completo
                  // (mismo criterio del diseño original -- funciona con foco
                  // en un input), no hace falta manejarlo aquí aparte.
                }}
              />
              <button type="button" className={styles.editorGuardar} onClick={guardar} disabled={guardando}>
                Guardar
              </button>
              <button type="button" className={styles.editorCancelar} onClick={() => setCapturando(false)}>
                cancelar
              </button>
            </div>
          ) : (
            <button type="button" className={styles.editorTrigger} onClick={empezarEdicion}>
              {sinLectura ? '+ Capturar placa a mano' : '✎ Editar placa'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
