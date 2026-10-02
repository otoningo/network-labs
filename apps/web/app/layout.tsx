import type { ReactNode } from 'react';

// Esqueleto de la fase 1: solo comprueba que la app compila importando @nos/core.
// La interfaz, los tokens de diseño y el i18n llegan en la fase 3.
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
