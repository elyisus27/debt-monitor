import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cruces de caseta — debt-monitor',
  description: 'Monitor de cruces de acceso (Hikvision ANPR)',
};

// Explícito (Next ya inyecta uno por defecto): la pantalla de Cruces tiene
// diseño móvil propio a ≤640px y necesita el ancho real del dispositivo.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
