# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Estudiantes de redes que ya tienen un conocimiento razonable de Cisco IOS y
quieren aprender otros sistemas operativos de red: MikroTik RouterOS primero,
luego Huawei VRP y VyOS. Hispanohablantes primero; inglés como segundo idioma.
Practican en sesiones cortas desde el navegador, sin instalar nada ni tener
equipos físicos.

## Product Purpose

Labs cortos en el navegador para practicar el CLI de varios sistemas
operativos de red: terminal simulada, topología, objetivos que se validan
contra el estado real de la red simulada y pistas escalonadas. El éxito es
que el estudiante complete el objetivo por cualquier camino válido y entienda
por qué funciona.

## Positioning

Cubre MikroTik RouterOS, Huawei VRP y VyOS, que plataformas de referencia del
mismo formato no cubren, y su valor central es la fluidez entre sintaxis:
el mismo objetivo resuelto en cada sistema, con comparación lado a lado.
Como los usuarios ya saben IOS, IOS sirve como punto de comparación.

## Operating Context

- Ruta inicial "MikroTik desde cero": 12 labs (acceso y CLI, interfaces y
  direcciones, rutas estáticas, bridge y VLANs, DHCP, NAT, firewall, wifi,
  DNS, respaldo, Torch, oficina completa).
- Cada lab: objetivos en lenguaje humano, topología inicial, validaciones
  sobre el estado del modelo (nunca comparación de comandos), pistas de sutil a
  explícita y explicación final.
- Pantalla de lab en tres zonas: objetivos a la izquierda, topología arriba a
  la derecha, terminal abajo a la derecha; redimensionable; en móvil, pestañas.
- Primer lab accesible sin registro.

## Capabilities and Constraints

- Todo corre en el cliente; sin backend en la v1. Progreso en localStorage
  detrás de una interfaz de datos reemplazable (Supabase después).
- Stack: Next.js App Router, TypeScript estricto, Tailwind, xterm.js, Zustand.
- Español e inglés desde el inicio con i18n real.
- No empaquetar imágenes, binarios ni documentación de fabricantes; no usar
  nombres ni logos de fabricantes como marca propia; aviso de no afiliación
  en el pie de página.
- Nombre del producto: Network Labs (D-042).

## Brand Commitments

- Debe verse como una herramienta de ingeniería, no como una landing de
  startup. Oscuro por defecto. Tipografía monoespaciada solo dentro de la
  terminal. Mucho espacio. Sin degradados ni efectos de cristal.
- Paleta corta y escala tipográfica definidas como variables CSS y usadas en
  todo. El acento de color se reserva para estado: objetivo cumplido, error,
  advertencia.

## Evidence on Hand

- Motor de simulación y driver de RouterOS funcionando, con 487 pruebas
  (packages/core, packages/vendors).
- No hay testimonios, usuarios, métricas ni capturas reales: no inventarlos.

## Product Principles

1. El estado manda: se valida lo que la red hace, no lo que se escribe.
2. La terminal se siente real: prompts, errores y salidas con la voz del equipo.
3. Nunca se entrega la respuesta completa; las pistas guían de sutil a explícita.
4. Aprender comparando: cada concepto se ancla en lo que el estudiante ya sabe de IOS.
5. Cero fricción: abrir el navegador y estar practicando en segundos.

## Accessibility & Inclusion

Accesible por teclado completo, con roles ARIA correctos, incluida la
terminal y el cambio entre zonas. Contraste WCAG AA como mínimo.
