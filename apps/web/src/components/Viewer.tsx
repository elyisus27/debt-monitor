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

  const foto = evento.fotos[fotoIndex];
  const { hora, fecha } = formatFechaHora(evento.timestamp);
  const sinLectura = !evento.placa;
  // Solo tiene sentido capturar a mano viendo la foto de placas -- en
  // cualquier otro canal no hay nada que leer.
  const enCanalPlacas = foto?.etiqueta === 'Placas';

  // Salir de "modo captura" al cambiar de foto/evento -- no dejar el input
  // enfocado (y las flechas bloqueadas) si el usuario navega a otra parte.
  useEffect(() => {
    setCapturando(false);
    setCaptura('');
  }, [evento.id, fotoIndex]);

  useEffect(() => {
    if (capturando) inputRef.current?.focus();
  }, [capturando]);

  const guardar = async () => {
    if (!captura.trim() || guardando) return;
    setGuardando(true);
    try {
      await onGuardarPlaca(captura.trim());
      setCaptura('');
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
              <img src={foto.url} alt={foto.etiqueta} />
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

        {sinLectura && enCanalPlacas && (
          <div className={styles.capturaManual}>
            {capturando ? (
              <>
                <div className={styles.capturaFila}>
                  <input
                    ref={inputRef}
                    type="text"
                    className={`input ${styles.capturaInput}`}
                    placeholder="ABC-12-34"
                    value={captura}
                    onChange={(e) => setCaptura(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') guardar();
                      // Esc: el listener global del visor ya lo cierra completo
                      // (mismo criterio del diseño original -- funciona con foco
                      // en un input), no hace falta manejarlo aquí aparte.
                    }}
                  />
                  <button type="button" className={styles.capturaBoton} onClick={guardar} disabled={guardando}>
                    Guardar placa
                  </button>
                </div>
                <p className={styles.capturaNota}>Escribe la placa tal como se ve en la foto y presiona Enter.</p>
              </>
            ) : (
              <button type="button" className={styles.capturaBoton} onClick={() => setCapturando(true)}>
                Capturar placa a mano
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
