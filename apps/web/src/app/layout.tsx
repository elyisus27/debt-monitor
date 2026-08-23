import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cruces de caseta — debt-monitor',
  description: 'Monitor de cruces de acceso (Hikvision ANPR)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
