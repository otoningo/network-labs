import { formatPrefix, networkOf, prefix } from '@nos/core';

// Placeholder temporal: se reemplaza por la portada en la fase 5.
export default function Home() {
  const lan = formatPrefix(networkOf(prefix('192.168.88.1/24')));
  return (
    <main>
      <p>
        @nos/core <code>{lan}</code>
      </p>
    </main>
  );
}
