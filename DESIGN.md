---
name: Network Labs
description: Labs de CLI de red en el navegador; una hoja de ejercicios que se corrige sola junto a la consola.
colors:
  ground: "#141618"
  sheet: "#181a1d"
  console: "#0f1012"
  rule: "#2a2e33"
  rule-strong: "#3a3f45"
  control: "#8a929a"
  ink: "#e3e6e8"
  ink-muted: "#a3aab1"
  ink-faint: "#7d858d"
  done: "#5fae7b"
  warn: "#e0b04f"
  error: "#d45b4f"
  done-quiet: "#1d2a22"
  warn-quiet: "#2d2618"
  error-quiet: "#2e1c1b"
  focus: "#e3e6e8"
  washi: "#be3820"
  washi-deep: "#b0341d"
  washi-edge: "#962c18"
  washi-edge-deep: "#7a2413"
  washi-back: "#efd9cc"
  washi-back-ink: "#9e2a1f"
  fold-white: "#f4efe6"
  washi-cream: "#ebe3d3"
  sumi: "#131214"
  gold: "#d4af37"
  crease: "rgb(244 239 230 / 0.28)"
  washi-ink-muted: "#f8e7de"
  washi-ink-faint: "#f6e0d6"
  sumi-ink-muted: "#cfc8be"
  sumi-ink-faint: "#a39c92"
  sumi-rule: "#2c2a2d"
  sumi-rule-strong: "#3d3a3e"
  cream-ink: "#161416"
  cream-ink-muted: "#45413d"
  cream-ink-faint: "#625d57"
  cream-rule: "#cfc5b3"
  cream-rule-strong: "#b3a891"
typography:
  hero:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 2vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
  numeral:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 300
    lineHeight: 1
    fontFeature: "\"tnum\" 1"
  section:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.55
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.55
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"tnum\" 1"
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
  fine:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
  console:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.35
  console-quote:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  landing-hero:
    fontFamily: "Jost, Geist, ui-sans-serif, sans-serif"
    fontSize: "clamp(2.4rem, 1.5rem + 3.2vw, 4.25rem)"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  landing-verb:
    fontFamily: "Jost, Geist, ui-sans-serif, sans-serif"
    fontSize: "clamp(2.75rem, 1.6rem + 4.4vw, 5rem)"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.02em"
  landing-close:
    fontFamily: "Jost, Geist, ui-sans-serif, sans-serif"
    fontSize: "clamp(2.25rem, 1.4rem + 3.4vw, 4rem)"
    fontWeight: 300
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  landing-section:
    fontFamily: "Jost, Geist, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 2vw, 2.75rem)"
    fontWeight: 300
    lineHeight: 1.1
  fold-label:
    fontFamily: "Jost, Geist, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.18em"
  fold-numeral:
    fontFamily: "Jost, Geist, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    fontFeature: "\"tnum\" 1"
  sheet-console:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
  landing-quote:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
  dot: "9999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  row: "20px"
  gutter: "24px"
  gutter-wide: "32px"
  section: "40px"
  footer: "48px"
  bar: "48px"
  page: "64px"
  page-wide: "96px"
  fold-split: "56px"
  landing-section: "80px"
  landing-section-wide: "112px"
components:
  top-bar:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    height: "48px"
    padding: "0 20px"
  site-header:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    height: "48px"
    padding: "0 24px"
  site-footer:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink-faint}"
    typography: "{typography.fine}"
    padding: "24px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-muted}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "44px"
  button-outline-hover:
    backgroundColor: "{colors.rule}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 2px"
    height: "32px"
  button-quiet-hover:
    textColor: "{colors.ink}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    rounded: "{rounded.sm}"
    size: "32px"
  button-icon-hover:
    backgroundColor: "{colors.rule}"
    textColor: "{colors.ink}"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  button-destructive-hover:
    backgroundColor: "{colors.error-quiet}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    padding: "0 12px"
    height: "44px"
  tab-active:
    textColor: "{colors.ink}"
  inline-code:
    backgroundColor: "{colors.rule}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.05em 0.3em"
  status-box:
    backgroundColor: "transparent"
    rounded: "{rounded.sm}"
    size: "18px"
  status-box-done:
    backgroundColor: "{colors.done}"
    textColor: "{colors.ground}"
  status-box-regressed:
    backgroundColor: "{colors.warn}"
    textColor: "{colors.ground}"
  select-console:
    backgroundColor: "{colors.console}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "28px"
  inspector:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-zoom:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    size: "32px"
  button-zoom-hover:
    backgroundColor: "{colors.rule}"
    textColor: "{colors.ink}"
  evidence-line:
    textColor: "{colors.ink-faint}"
    typography: "{typography.label}"
  link-next:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  console-quote:
    backgroundColor: "{colors.console}"
    textColor: "{colors.ink}"
    typography: "{typography.console-quote}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  path-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "20px 0"
  landing-header:
    backgroundColor: "{colors.washi-deep}"
    textColor: "{colors.fold-white}"
    typography: "{typography.body-sm}"
    height: "48px"
    padding: "0 32px"
  landing-footer:
    backgroundColor: "{colors.sumi}"
    textColor: "{colors.sumi-ink-faint}"
    typography: "{typography.fine}"
    padding: "24px 32px"
  button-fold:
    backgroundColor: "{colors.fold-white}"
    textColor: "{colors.sumi}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "48px"
  button-fold-outline:
    backgroundColor: "transparent"
    textColor: "{colors.fold-white}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "48px"
  button-fold-outline-hover:
    backgroundColor: "{colors.fold-white}"
    textColor: "{colors.sumi}"
  link-verb:
    textColor: "{colors.cream-ink}"
    typography: "{typography.title}"
  sheet-console:
    backgroundColor: "{colors.washi}"
    textColor: "{colors.fold-white}"
    typography: "{typography.sheet-console}"
    width: "34rem"
  step-list:
    textColor: "{colors.sumi-ink-faint}"
    typography: "{typography.fold-label}"
    padding: "6px 0 6px 16px"
  step-list-active:
    textColor: "{colors.fold-white}"
  step-dot:
    backgroundColor: "{colors.gold}"
    rounded: "{rounded.dot}"
    size: "9px"
  fold-station:
    backgroundColor: "{colors.sumi}"
    textColor: "{colors.sumi-ink-faint}"
    rounded: "{rounded.sm}"
    size: "48px"
  fold-station-reached:
    textColor: "{colors.fold-white}"
  fold-slip:
    backgroundColor: "{colors.fold-white}"
    textColor: "{colors.sumi}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  landing-quote:
    backgroundColor: "{colors.sumi}"
    textColor: "{colors.fold-white}"
    typography: "{typography.landing-quote}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  practice-row:
    textColor: "{colors.cream-ink}"
    typography: "{typography.body}"
    padding: "10px 0"
  status-box-landing-done:
    backgroundColor: "{colors.washi}"
    textColor: "{colors.fold-white}"
    rounded: "{rounded.sm}"
    size: "18px"
---

# Design System: Network Labs

## Overview

**Creative North Star: "El cuaderno de prácticas que se corrige solo"**

La pantalla de lab es una hoja de ejercicios impresa en grafito: tareas numeradas con su casilla, una figura de topología rotulada "Fig. 1" con su pie y la consola al lado. No es un IDE. No hay pestañas de archivos, árbol de ficheros ni carril de iconos; las zonas se separan con filetes de 1px, no con tarjetas. La densidad es la de una guía de prácticas: mucho aire entre tareas, texto en una medida de lectura y una sola tipografía de interfaz.

El color es casi todo tinta sobre grafito. El único color con significado es el de estado, y vive en la casilla de cada tarea (verde cumplida, ámbar "se cumplía y ya no"). Numerales, progreso de la barra, contador de la pestaña y título de lab completado son monocromos. El rojo no es un estado de objetivo: un objetivo no falla, está pendiente o en regresión; el rojo queda para la confirmación destructiva de reiniciar.

Es una herramienta de ingeniería, y las rutas y la referencia son páginas del mismo cuaderno: oscuro único, sin degradados, sin cristal, sin sombras. Las rutas listan sus labs con la misma fila de la hoja. La monoespaciada existe solo en superficies de consola (la terminal del lab y las consolas citadas); lo que se cita de la consola dentro de una frase va en la misma sans con un fondo. La portada salió del cuaderno con D-041: tiene mundo propio, la grulla plegada, descrito en cada sección bajo "Portada: grulla plegada".

**Key Characteristics:**
- Grafito casi negro en tres escalones (consola, fondo, cajas de la figura) y tinta blanco papel en tres tonos.
- Filetes de 1px como única estructura; nada de tarjetas ni sombras.
- Numerales de tarea grandes y ligeros, en un solo tono en todo estado.
- La casilla de estado es el portador del color de estado.
- Geist en la interfaz, Geist Mono solo en superficies de consola.
- Las superficies de trabajo usan el principal con borde; ninguna lleva un botón relleno.
- Esquinas casi rectas (2px) en todo.

### Portada: grulla plegada (D-041)

**Creative North Star de la portada: "La hoja que se pliega en paquete"**

Solo la portada (`/[locale]`) vive en este mundo; lab, rutas y referencia siguen en el cuaderno. La portada es un diagrama de plegado numerado: encapsular es doblar y entregar es desplegar. El hero es washi bermellón a sangre con fibra de kozo; en él, un cuadrado de papel con sus guías de pliegue lleva escrita la consola real del router de práctica. Al bajar, esa hoja se pliega capa a capa (datos, TCP, IP, Ethernet) sobre negro sumi, viaja por la red que calcula el motor, R1 le tacha el remite y en el destino se despliega en las dos páginas crema de Aprender y Practicar. Cierra otra vez en bermellón.

Las líneas de pliegue son la única geometría: no hay tarjetas. Todo lo que se ve sale del motor (la consola del hero es un store real; el viaje es el `trace` de PC1 a example.com:443). La fibra son dos placas PNG generadas con semilla fija por `apps/web/scripts/washi-texture.mjs` (`public/landing/washi.png` y `washi-cream.png`); no hay imágenes de terceros. La cabecera y el pie compartidos se visten con la variante `landing` del marco del sitio.

**Key Characteristics (portada):**
- Tres superficies que redefinen la tinta: bermellón, sumi y crema; los componentes compartidos heredan la tinta correcta.
- Fibra de kozo en placa de 320px sobre el color, tan tenue que el blanco de pliegue sigue por encima de 4.5:1 en el 95 % del papel.
- Jost fina en display y versalitas espaciadas en los rótulos; Geist en el cuerpo; mono solo en consolas y citas.
- Dorado solo en el punto del paso activo.
- Un solo botón relleno (blanco de pliegue) en el hero; el del cierre va con borde.
- Esquinas de 2px en controles; el papel va a escuadra y el punto dorado es el único círculo.
- El plegado se mueve con el scroll; con movimiento reducido o pantalla baja, una lista quieta.

## Colors

Grafito neutro casi negro con tinta fría; el color saturado está reservado al estado y nunca decora.

### Primary
No hay acento de marca. La jerarquía la hace la tinta (ink, ink-muted, ink-faint), y el foco usa la misma tinta (focus) para no confundirse con un estado. El botón principal de la portada se rellena de tinta con el texto en grafito de fondo: es tinta invertida, no un acento.

### Secondary
- **Verde de casilla cumplida** (done): relleno de la casilla de una tarea cumplida, con la marca en el color del fondo. Dentro de la consola, el verde ANSI se reduce a este token.
- **Ámbar de regresión** (warn): relleno de la casilla de una tarea que se cumplía y ya no, y la nota corta de regresión bajo el enunciado de esa misma tarea.

### Tertiary
- **Rojo destructivo** (error): solo el borde y el texto del botón que confirma reiniciar el lab, con su fondo tenue (error-quiet) al pasar el puntero. En la consola, el rojo ANSI se reduce a este token. Nunca marca un objetivo.

### Neutral
- **Grafito de fondo** (ground): fondo de la pantalla, de la hoja y de la figura.
- **Grafito de hoja** (sheet): relleno de las formas de equipo en la figura, del panel de detalle (inspector) y del enlace "saltar a la consola".
- **Grafito de consola** (console): el escalón más oscuro, solo en superficies de consola: la consola del lab y su franja, la consola de la demostración y las citas de consola de la portada, y la zona de consola del esquema "Fig. 2".
- **Filete** (rule): divisiones entre zonas, filas de tareas, barra superior, pie, enlace al siguiente lab; borde del grupo de zoom; fondo del código citado; fondo del botón de icono al pasar.
- **Filete marcado** (rule-strong): separador al pasar el puntero, bordes de equipo en reposo, cables y asociaciones caídos, borde del inspector, botones de zoom deshabilitados, selección de texto, barras de desplazamiento.
- **Gris de control** (control): borde de casillas vacías, borde del botón principal con borde, subrayado en reposo de los enlaces de texto, segmentos de progreso pendientes, cables y asociaciones wifi activos de la figura y borde del equipo cuyo detalle se muestra. Está en 5,2:1 sobre el fondo porque el filete de 1px se suaviza al pintarse y debe seguir por encima de 3:1 (WCAG 1.4.11).
- **Tinta** (ink): texto principal, enunciados, título, relleno del botón principal de la portada, enlace de la página actual en la cabecera, pestaña activa, anillo de foco, borde del equipo activo, id de equipo en la figura, enlace al siguiente lab.
- **Tinta media** (ink-muted): resumen del lab, entradilla de la portada y segunda frase del titular, pistas, encabezados "Tareas" y "Labs", "En curso: x de y", recuento "n de 12 labs terminados", relleno del botón principal al pasar, botones discretos, segmentos de progreso cumplidos, nombre de puerto y nombre en vivo en la figura.
- **Tinta tenue** (ink-faint): numerales, metadatos, pie de figura, direcciones y etiquetas de la figura, línea de verificación, botones de zoom, metadatos de ruta y de lab, prompts de las citas de consola, aviso legal, idioma no activo.

### Named Rules
**La Regla de la Casilla.** El color de estado vive en la casilla de la tarea (y en la nota de regresión de esa misma fila). Numerales, progreso, contadores y títulos de lab completado son monocromos.

**La Regla del Rojo Destructivo.** El rojo no es un estado de objetivo. Solo marca una acción que destruye trabajo, y los errores del equipo salen en la consola con su propia voz.

**La Regla del Foco de Tinta.** El anillo de foco es de tinta (2px, separado 2px), nunca de un color de estado.

### Portada: grulla plegada
Papel bermellón, tinta sumi y crema de washi, con un solo toque de oro. Los tokens viven bajo `.landing` y cada banda declara su superficie (`.on-washi`, `.on-sumi`, `.on-cream`), que redefine tinta, tinta media, tinta tenue, filete, control y foco para que los componentes compartidos hereden el tono correcto.

- **Washi bermellón** (washi): la hoja con consola del hero, las piezas del plegado, la banda de cierre, el subrayado de 2px de los enlaces de verbo, los verbos "Aprender" y "Practicar" sobre crema (4.38:1, solo en texto grande) y el relleno de la casilla cumplida en la lista de Practicar.
- **Bermellón hondo** (washi-deep): fondo del hero y de la cabecera, que lo continúa.
- **Cantos** (washi-edge, washi-edge-deep): el grosor apilado bajo las piezas plegadas; el hondo, además, oscurece la solapa al pasar por la vertical (hasta 0.6 de opacidad).
- **Revés del papel** (washi-back, con su tinta washi-back-ink): las capas se alternan de cara, bermellón y revés claro; la tinta del revés marca también el remite nuevo y el tachado de la etiqueta del paquete.
- **Blanco de pliegue** (fold-white): texto sobre bermellón y sumi, el botón relleno del hero, el borde del botón de cierre, la etiqueta del paquete, el cable entintado, la estación alcanzada, la selección de texto y el foco.
- **Crema de washi** (washi-cream): las páginas de Aprender y Practicar, con su placa de vetas claras.
- **Sumi** (sumi): el viaje, el pie, el fondo de la portada, las citas de consola y el interior de las estaciones.
- **Oro** (gold): el punto de 9px del paso activo. Nada más.
- **Pliegue** (crease): las guías de pliegue, el filete de las superficies bermellón, el cable sin entintar y el subrayado en reposo del enlace discreto del hero.
- **Tintas por superficie:** sobre bermellón, washi-ink-muted y washi-ink-faint; sobre sumi, sumi-ink-muted, sumi-ink-faint y los filetes sumi-rule y sumi-rule-strong; sobre crema, cream-ink, cream-ink-muted, cream-ink-faint (también borde de control) y los filetes cream-rule y cream-rule-strong.

**La Regla del Punto Dorado.** El oro solo rellena el punto del paso activo de la columna de pasos. Nunca en texto, bordes, botones ni fondos.

**La Regla de la Superficie que Entinta.** Cada banda declara su superficie y los componentes usan los tokens de tinta, que heredan. Lo que va sobre otro escalón dentro de una banda (la cita sumi sobre crema) toma la tinta de ese escalón.

**La Regla de la Fibra Legible.** Sobre la fibra, el texto mantiene 4.5:1 en el percentil 95 del papel. Pasan el blanco de pliegue sobre bermellón (4.60:1) y sobre bermellón hondo (5.15:1), la tinta media del bermellón sobre bermellón hondo (4.91:1), la tenue sobre bermellón hondo (4.65:1, los pasos inactivos del hero) y las tres tintas de la crema (5.1:1 o más). No pasan sobre fibra la tinta media ni la tenue sobre el bermellón de la hoja (4.39 y 4.16:1): en la hoja el texto va en blanco de pliegue.

## Typography

**Display Font:** Geist (con ui-sans-serif, system-ui)
**Body Font:** Geist (con ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono, solo en superficies de consola (con ui-monospace)

**Character:** Una sola sans neutra y técnica para toda la interfaz, con cifras tabulares por defecto; la mono queda encerrada en la terminal para que la consola se lea como otro mundo, el del equipo.

### Hierarchy
- **Hero** (600, fluido de 1.75rem a 2.5rem, 1.15, tracking -0.02em): era el titular de la portada del cuaderno; retirado con D-041, sin uso hoy.
- **Display** (600, 1.75rem): título del lab al inicio de la hoja (1.25) y título de las páginas de rutas (1.2), equilibrado (text-balance).
- **Section** (600, 1.375rem): títulos de sección dentro de una página del cuaderno. Sus usos en la portada se retiraron con D-041.
- **Numeral** (300, 2.5rem, 1, tabular): numeral de cada tarea, alineado a la derecha en su columna, en tinta tenue y un solo tono en todo estado.
- **Headline** (600, 1.0625rem): título de la sección "lab completado" y nombre de cada ruta en el índice; en 400, la entradilla de la portada.
- **Title** (500, 0.9375rem): título del lab en la barra superior; el nombre del producto va en 600 con tracking ajustado.
- **Body** (400, 0.9375rem, 1.55): enunciados de tarea, resumen y explicación final, introducciones de rutas y de secciones de la portada, con medida máxima de 62ch. En 500: títulos de lab en las filas de ruta y botones principales.
- **Body small** (400, 0.875rem): pistas, encabezado "Tareas" (en 600), navegación de la barra, pestañas y botones.
- **Label** (400, 0.8125rem): metadatos (dificultad · minutos · tareas; sistema · labs · minutos), pie de figura, franja de la consola, nota de regresión, línea de verificación, inspector.
- **Fine** (400, 0.75rem): aviso legal del pie, franja con el sistema de cada cita de consola y rótulos del esquema "Fig. 2". Es el tamaño mínimo de la interfaz.
- **Figura** (Geist 12px, el mismo paso que fine; ids 13px en 600): texto del lienzo de topología, contraescalado para medir siempre lo mismo en pantalla a cualquier zoom.
- **Console** (Geist Mono 13.5px, 1.35): todo lo que pinta la terminal, también la consola de la demostración de la portada.
- **Console quote** (Geist Mono 13.5px, 1.45): bloques de consola citados en la portada (IOS frente a RouterOS); el interlineado se abre porque las líneas largas se parten.

La escala va en rem (relación aproximada 1.2) para respetar el zoom del usuario.

### Named Rules
**La Regla de la Mono Encerrada.** Geist Mono solo en superficies de consola: la terminal del lab, la consola de la demostración y los bloques de consola citados sobre grafito de consola. Nunca en prosa, rótulos ni en el marco de la interfaz. El código citado dentro de una frase (tareas, pistas, notas) es Geist en peso 500 sobre un chip de filete.

**La Regla del Numeral Callado.** El numeral es grande y ligero, y nunca cambia de color: el estado lo dice la casilla.

**La Regla del Texto Fijo.** En la figura, el zoom escala formas y cables, nunca el texto: rótulos, direcciones, etiquetas y nombre en vivo miden 12px en pantalla y los ids 13px en 600, a cualquier escala.

### Portada: grulla plegada
**Display Font:** Jost (con Geist), cargada con next/font como `--font-display` y usada solo en la portada, en pesos 300 y 400.
**Body Font:** Geist, como en el resto.
**Mono:** Geist Mono, solo en la consola de la hoja y en las citas de Aprender.

**Character:** Una geométrica fina para los titulares, como el trazo de un diagrama de plegado, y versalitas espaciadas para rotular capas, pasos y equipos; el cuerpo se queda en la sans de la interfaz.

- **Landing hero** (Jost 300, fluido de 2.4rem a 4.25rem, 1.06, tracking -0.025em): el titular del hero en dos líneas, la segunda en 400. Desde 1024px no se parte y mide lo que deje su columna (hasta 3.5rem).
- **Landing verb** (Jost 300, fluido de 2.75rem a 5rem, 1, -0.02em): "Aprender" y "Practicar", en bermellón sobre crema.
- **Landing close** (Jost 300, fluido de 2.25rem a 4rem, 1.05, -0.02em): titular del cierre.
- **Landing section** (Jost 300, fluido de 1.75rem a 2.75rem, 1.1): titular del viaje, en la escena animada y en la lista quieta.
- **Entradilla** (Geist 400, 1.0625rem): bajo cada titular, en 46 a 52ch.
- **Fold label** (Jost 0.75rem, mayúsculas, 0.18em): rótulos del diagrama: nombres de paso, capas, equipos, "IOS" y "RouterOS", el nombre de la ruta y el contador "01 / 07". Se cierra a 0.1em dentro de una pieza y a 0.08em en las estaciones de un teléfono; en la tira del último pliegue va de canto.
- **Fold numeral** (Jost 400, 0.875rem, tabular): 01 a 07 en la columna de pasos y en la lista quieta. El numeral de lab en Practicar es Jost 300 a 1.375rem.
- **Sheet console** (Geist Mono 0.8125rem, 1.6): la consola escrita en la hoja del hero.
- **Landing quote** (Geist Mono 0.78rem, 1.5): las citas IOS y RouterOS de Aprender.

**La Regla de la Mono Encerrada, en la portada.** Mono solo dentro de la consola de la hoja y de las citas de consola; rótulos, cifras de la etiqueta del paquete e interfaces van en Geist o Jost con cifras tabulares.

**La Regla del Rótulo en Versalitas.** Las versalitas rotulan partes del diagrama (un paso, una capa, un equipo, una lista). No van encima de un titular como antetítulo.

## Layout

Tres zonas sobre una rejilla de altura completa (100dvh): barra superior de 48px y, debajo, el banco de trabajo.

- **Escritorio (≥1024px):** paneles redimensionables. Hoja de tareas a la izquierda (400px por defecto, mínimo 300px, máximo 55%). A la derecha, figura arriba (38%, mínimo 120px, plegable) y consola abajo (mínimo 160px). Los separadores son líneas de 1px de filete con zona sensible más ancha; al pasar se marcan, al arrastrar se aclaran y con foco de teclado se vuelven tinta.
- **Por debajo de 1024px:** pestañas Tareas · Topología · Consola, con el contador n/m de tareas en tinta tenue junto a "Tareas". La consola sigue montada aunque su pestaña no esté visible.
- **Barra superior:** la ruta y el número de lab aparecen desde 768px; el texto "n de m tareas" desde 640px; el texto de confirmación de reinicio desde 1024px.
- **Hoja:** consulta de contenedor; padding de 24px (32px cuando el contenedor pasa de 28rem). Las tareas son una rejilla de tres columnas compartidas (numeral, enunciado, casilla) con 16px de separación y 20px de aire vertical por fila, así un cambio de estado no mueve nada.
- **Lienzo de la figura:** ocupa el panel; zoom entre 0.5× y 3× (paso 1.25×, rueda, pellizco, + y −), desplazamiento arrastrando o con flechas (40px) y encuadre (0) que centra con 16px de margen sin pasar de 1.5×. El reparto de equipos se elige para que formas y rótulos no se crucen, con el marco redondeado a 40px para no temblar al arrastrar el separador; en un panel estrecho y vertical (menos de 640px de ancho y más alto que ancho) puede trasponerse. Límite conocido: el lab 12 en un teléfono de 375px encuadra más ancho que el panel y hay que desplazarse.
- **Marco del sitio (rutas y referencia):** columna centrada de 72rem como máximo con 16px de margen lateral (24px desde 640px), cabecera de 48px y pie al final de una página de altura mínima completa. Las páginas de rutas leen en una columna de 48rem.
- **Portada:** retirada del cuaderno con D-041; ver "Portada: grulla plegada" al final de esta sección.
- **Botón principal en el teléfono:** por debajo de 640px "Continuar: Lab N. Título" se acorta a "Continuar: Lab N"; el título completo queda en el nombre accesible.
- **Metadatos indivisibles:** cada dato de una línea de metadatos va sin salto interno; la línea se corta entre datos, por los puntos separadores.
- **Ritmo:** escala de 4px. Pasos recurrentes: 4, 8, 12, 16, 20, 24, 32, 40 (entre bloques de la hoja) y 48px (antes del pie); 64 y 96px entre secciones de la portada.

### Portada: grulla plegada
- **Marco:** variante `landing` del marco del sitio. Cabecera y pie en una columna de 80rem (max-w-7xl) con 16px de margen lateral y 32px desde 640px; la cabecera mantiene 48px y no lleva filete (su bermellón hondo sigue en el hero) y el pie va sobre sumi sin filete. Todas las bandas de la portada usan la misma columna de 80rem.
- **Hero:** desde 1024px ocupa la altura de la pantalla menos la barra, en tres columnas (1.3fr texto, 1fr hoja con consola de 34rem como máximo, 11rem columna de pasos) con 48px entre ellas; por debajo se apila y la columna de pasos se oculta. La hoja es cuadrada desde 640px; en el teléfono crece en alto (24rem como mínimo).
- **Viaje:** una sección de 640vh con un escenario fijo de una pantalla. Desde 1024px, la columna de pasos va a la derecha en 15rem tras un filete. La red va al 78 % del alto (66 % por debajo de 640px), con las cuatro estaciones al 12, 38, 60 y 80 % del ancho (13, 37, 61 y 85 % en estrecho). La hoja cabe entre el titular y la red, de 120 a 360px.
- **Lista quieta:** cuadrícula de pasos entre filetes, en una, dos (640px) o tres columnas (1024px), con 80px de aire.
- **Aprender y Practicar:** dos páginas a cada lado de un pliegue discontinuo vertical desde 1024px, con 56px a cada lado y 80px de aire vertical (112px desde 1024px); por debajo se apilan.
- **Cierre:** 96px de aire; titular y botón en dos columnas desde 1024px, con el botón abajo a la derecha.
- **Movimiento reducido o pantalla de 479px de alto o menos:** el CSS oculta el viaje animado y muestra la lista quieta antes de pintar, sin esperar a hidratar.

## Elevation & Depth

El cuaderno es plano por completo. No hay ninguna sombra. La profundidad se da con tres escalones de grafito (consola más oscura, fondo, formas de la figura y el inspector más claros) y con filetes de 1px. Lo activo se marca subiendo el filete a tinta, no levantando la superficie; el inspector flota sobre el lienzo solo con su escalón de grafito y un borde de filete marcado.

### Named Rules
**La Regla del Filete.** Las zonas se separan con una línea de 1px, nunca con una tarjeta, un fondo elevado o una sombra.

### Portada: grulla plegada
La portada no es plana: el papel tiene grosor y se levanta. Las sombras son de papel sobre la mesa, suaves y teñidas de bermellón o de negro, y los cantos apilados dicen cuántas capas hay.

- **Hoja en la mesa** (`box-shadow: 0 24px 48px rgb(60 8 4 / 0.45)`): la hoja con consola del hero.
- **Botón de pliegue** (`box-shadow: 0 10px 24px rgb(60 8 4 / 0.35)`): el botón relleno del hero, que sube 1px al pasar y baja 1px al pulsar.
- **Hoja en vuelo** (`filter: drop-shadow(0 18px 26px rgb(0 0 0 / 0.5))`): la hoja que se pliega y viaja.
- **Etiqueta del paquete** (`box-shadow: 0 10px 22px rgb(0 0 0 / 0.35)`).
- **Cantos** (`0 2px 0` en washi-edge y `0 4px 0` en washi-edge-deep): solo bajo las piezas plegadas, una línea por capa ya doblada. Es el grosor del papel, no un recurso de tarjeta.
- **Pliegue:** filete interior de 1px en crease (en el revés, su tinta al 25 %) y un filete oscuro en el lado de la bisagra.

**La Regla de la Sombra de Papel.** Solo proyecta sombra lo que es papel o se apoya en él (la hoja, la pieza plegada, la etiqueta, el botón de pliegue). Las bandas, las listas y las citas siguen planas.

## Shapes

Esquinas casi rectas: 2px en botones, casillas, chips de código, selector, foco, inspector, grupo de zoom y formas de la figura (2px en pantalla a cualquier zoom). No hay formas redondeadas ni píldoras; la nube de Internet es la única silueta curva y es un pictograma, no una esquina.

El icono de la aplicación es un prompt: ">" en trazo de tinta de corte recto y un cursor de bloque en tinta, sobre grafito de fondo con un filete marcado alrededor. Es el mismo cursor de bloque de la consola.

La forma de cada equipo dice su papel: router como caja con una muesca arriba (la ranura de un chasis), equipo como caja simple, equipo inalámbrico como caja con dos arcos y un punto, Internet como nube. Los trazos no escalan con el zoom: 1px en reposo, 1.5px en el equipo activo y en los cables.

**La Regla del Trazo que Dice el Medio.** Cable activo: línea continua en gris de control. Asociación wifi activa: discontinua (6 4) en gris de control. Caídos, en filete marcado: cable discontinuo (4 4), wifi punteado (2 4).

### Portada: grulla plegada
El papel va a escuadra: la hoja del hero, las piezas y las solapas no redondean. Los controles y las piezas pequeñas mantienen los 2px del cuaderno (botones, casillas, citas, etiqueta del paquete, marcas de estación). El punto dorado del paso activo es el único círculo.

Las guías de la hoja son las de un cuadrado de origami: diagonales, medianas y el rombo interior en línea continua de 1px, y los cuartos verticales discontinuos, todo en crease. Entre Aprender y Practicar, un pliegue vertical discontinuo en cream-rule-strong. La hoja se pliega en tres tiempos: mitad a la izquierda, mitad hacia abajo y la tira final, de canto.

Los equipos del viaje son marcas cuadradas de 48px (34px por debajo de 640px) con 1px de borde y, dentro, un pictograma Phosphor en peso light al 62 %: Desktop (PC1), Network (R1), Cloud (ISP) y HardDrives (el destino).

## Components

### Buttons
Discretos y tipográficos: casi siempre texto sin caja. Hay un único principal por pantalla, y su forma depende de la superficie.
- **Shape:** esquinas de 2px.
- **Principal relleno (portada):** retirado con D-041; la portada usa el botón de pliegue de su propio mundo.
- **Principal con borde (rutas):** borde de gris de control, texto en tinta en 500, 44px de alto mínimo, 8px × 16px, flecha de 15px; al pasar, borde de tinta y fondo de filete. "Empezar", "Continuar: Lab N. Título" o "Repasar". Hasta leer el progreso ocupa su sitio sin verse.
- **Enlace de texto:** tinta con subrayado de 1px en gris de control (separado 0.2em) que pasa a tinta al pasar; el secundario, en tinta media con subrayado de filete marcado.
- **Discreto (pedir pista):** texto en tinta media con icono de bombilla de 15px, sin fondo; pasa a tinta al pasar el puntero. Alto mínimo 44px en táctil y 32px desde 1024px.
- **Icono (reiniciar):** cuadro de 32px, icono de 16px en tinta tenue; al pasar, fondo de filete y tinta.
- **Destructivo (confirmar reinicio o borrar el progreso de una ruta):** borde y texto en rojo destructivo, fondo tenue rojo al pasar. La confirmación ocurre en el sitio en dos pasos, sin ventana modal: un botón discreto la abre, la pregunta aparece en tinta media y el foco salta al botón rojo; Escape o "Cancelar" la cierran y devuelven el foco.
- **Hover / Focus:** cambios de color solamente; el foco es el anillo de tinta global.

**La Regla del Botón Principal.** Las superficies de trabajo (lab, rutas, referencia) usan el principal con borde, nunca un botón relleno. La portada tiene un único botón relleno, el de pliegue, en su propio mundo.

### Chips
- **Código citado:** Geist 500 a 0.95em, fondo de filete, tinta, 2px de radio, sin salto de línea.

### Inputs / Fields
- **Selector de equipo de la consola:** 28px de alto, fondo de consola, filete de borde que pasa a filete marcado al pasar, texto de 0.8125rem.

### Navigation
- **Marco del sitio (rutas y referencia):** cabecera de 48px con filete inferior: el nombre del producto en 600 con tracking ajustado, los enlaces "Aprender" (referencia) y "Practicar" (rutas), en ese orden, en 0.875rem (tinta media, tinta al pasar o en la página actual, con aria-current) y el idioma a la derecha. Enlace "saltar al contenido" que aparece con foco sobre grafito de hoja. El contenido va en `main#main`. Pie tras un filete con el aviso de no afiliación en 0.75rem tinta tenue, 72ch como máximo, 24px de aire. La pantalla de lab conserva su propia barra.
- **Barra superior (lab):** 48px, filete inferior. Nombre del producto, ruta / lab n en tinta tenue y media, título del lab, progreso, idioma y reinicio a la derecha.
- **Idioma:** códigos en mayúsculas en 0.875rem; el activo en tinta, el resto en tinta tenue que pasa a tinta media al pasar. Conserva la página actual.
- **Progreso:** un segmento de 10px por tarea; cumplido relleno en tinta media, pendiente o en regresión solo con borde de control. Transición de color de 500ms.
- **Pestañas (móvil):** texto de 0.875rem, 44px de alto, subrayado de 2px en tinta en la activa.

### Casilla de estado (firma)
Cuadro de 18px con borde de control y 2px de radio. Cumplida: relleno verde con marca de verificación en negrita (13px) en el color del fondo. En regresión: relleno ámbar con icono de aviso. Una marca nueva durante la sesión entra con escala 0.6→1 y opacidad en 260ms con salida suave (cubic-bezier(0.16, 1, 0.3, 1)); lo restaurado aparece quieto. Es decorativa: el estado se dice en texto oculto en la fila.

### Fila de tarea (firma)
Numeral, enunciado con sus pistas y casilla en columnas fijas, con filete superior. Las pistas reveladas se listan bajo el enunciado como "1 de 2" en tinta tenue seguido del texto en tinta media.

### Figura de topología (firma)
Lienzo SVG interactivo que sigue siendo la "Fig. 1" del cuaderno. Formas en grafito de hoja (router 132×48, equipo 116×44, nube 128×60 en unidades de mundo) con el id en tinta 600 y, debajo, el nombre en vivo del equipo en tinta media cuando difiere del id y cabe; la etiqueta va bajo la forma en tinta tenue. Borde de tinta en el equipo cuya consola está activa, gris de control en el que muestra su detalle, filete marcado en el resto. Cada extremo de cable es un solo bloque a un lado de la línea: el nombre del puerto en tinta media con sus direcciones debajo en tinta tenue, leídos de la red en vivo. Sobre cada forma hay un botón HTML transparente (abre la consola del equipo, aria-pressed) o un elemento enfocable si el equipo no tiene consola. Pie: "Fig. 1." en 500 tinta media seguido del texto en tinta tenue; en su misma fila, a la derecha, el grupo de zoom. Incluye una alternativa en texto oculta visualmente con equipos y enlaces. Nunca muestra tráfico ni contadores.

### Inspector (firma)
Detalle de un equipo al pasar el puntero o al enfocarlo: panel de grafito de hoja con borde de filete marcado, 2px de radio, texto de 0.8125rem, colocado junto a la forma y cambiado de lado si no cabe. Id en 600 con su papel en tinta tenue, nombre en vivo en tinta media, y una tabla bajo un filete con cada interfaz (nombre en 500 tinta), su estado y sus direcciones. Esc lo oculta; no se muestra mientras se desplaza.

### Controles de zoom
Grupo de tres botones de 32px (acercar, alejar, encuadrar) con iconos Phosphor de 16px en tinta tenue, dentro de un borde de filete con divisiones de filete y 2px de radio. Al pasar, fondo de filete y tinta; deshabilitados en filete marcado.

### Línea de verificación
Bajo el enunciado de una tarea cumplida o en regresión: lo que la red reporta, en 0.8125rem tinta tenue con cifras tabulares, como lista de definición con el rótulo "La red reporta" solo para lectores de pantalla. Cada línea sigue el patrón "equipo: dato = valor" o, para flujos, "ping PC1 → 192.168.88.1: llega" / "no llega, motivo". Sin color de estado: el estado ya lo dice la casilla.

### Fila de ruta (firma)
La fila de tarea aplicada a un lab de la ruta: numeral grande y ligero en tinta tenue, título del lab en 500 tinta (subrayado al pasar), resumen en 0.875rem tinta media y metadatos en 0.8125rem tinta tenue (dificultad · minutos · tareas) con puntos separadores y cada dato sin salto interno; a la derecha, la casilla de estado, verde si el lab está terminado en este navegador. Un lab a medias añade "En curso: x de y" en tinta media al final de los metadatos. Mismo filete superior, 20px de aire y columnas fijas: leer el progreso no mueve nada. Sobre la lista, "Labs" en 0.875rem 600 tinta media.

### Lista de labs de la portada
*Retirado de la portada con D-041; no se usa hoy.* Versión compacta de la fila de ruta: numeral de 1.375rem en 300, título en 500 (toda la fila es el enlace), minutos en 0.8125rem tinta tenue y la casilla. "En curso: x de y" va bajo el título en el teléfono y junto a los minutos desde 640px.

### Índice de rutas
Lista entre filetes en una columna de 48rem. Por ruta publicada: el nombre en 1.0625rem 600 como enlace subrayado en gris de control, la descripción en tinta media, los metadatos (sistema · labs · minutos en total) y, debajo, el principal con borde junto a "n de 12 labs terminados" en tinta media. Las rutas en preparación van debajo con el nombre en tinta media, su sistema en tinta tenue y "En preparación" en tinta tenue, a la derecha desde 640px. La página de una ruta repite cabecera, metadatos y acción, y añade la fila de ruta y el borrado en dos pasos.

### Demostración del motor (firma de la portada)
*Retirado de la portada con D-041; no se usa hoy.* "Fig. 1" de la portada: una fila de tarea real del lab 1 con su línea de verificación reservada y, debajo, una superficie de consola de 2px de radio con franja de 40px ("Consola de R1" y "Repetir" discreto) y la terminal en Geist Mono. El comando se teclea a ritmo irregular, se ejecuta en el motor real, cambia el prompt y la casilla se marca con la animación de siempre. Se reproduce una vez al entrar en pantalla; con movimiento reducido muestra el estado final. Pie "Fig. 1." en 500 tinta media y el texto en tinta tenue.

### Cita de consola
Bloque de consola citado sobre grafito de consola con 2px de radio: franja con el sistema ("Cisco IOS", "MikroTik RouterOS v7") en 0.75rem tinta tenue sobre un filete, y las líneas en Geist Mono 13.5px con interlineado 1.45, prompt en tinta tenue y comando en tinta; las líneas largas se parten. Hoy la usa la referencia de comandos.

### Esquema del lab
*Retirado de la portada con D-041; no se usa hoy.* "Fig. 2" de la portada: la pantalla de lab dibujada con filetes marcados en 16:10 (hoja de tareas, figura y consola en grafito de consola) con tres filas de numeral, barra y casilla vacía. Decorativo y oculto a lectores de pantalla; el texto de al lado dice lo mismo.

### Siguiente lab
Al final de la sección de lab completado, tras un filete: "Siguiente" en 0.875rem tinta media y el número y título del lab en 500 tinta, subrayado al pasar, con flecha Phosphor de 15px en negrita. Si no hay siguiente, "Era el último lab de la ruta." en 0.875rem tinta media.

### Consola (firma)
Escalón de grafito más oscuro, franja de 40px con "Consola de R1" en 0.8125rem. El tema de xterm se lee de los tokens; la paleta ANSI se reduce a ellos. Cursor de bloque sin parpadeo. Con foco, un anillo de tinta de 2px dibujado por encima del lienzo.

### Portada · Marco en variante landing
El mismo marco del sitio (`SiteShell` con `variant="landing"`) sobre los tokens de la portada. Cabecera de 48px en bermellón hondo sin filete, con la tinta del bermellón: nombre en 600, enlaces "Aprender" y "Practicar" en ese orden (tinta media del bermellón, blanco de pliegue al pasar o en la página actual) e idioma a la derecha. Pie sobre sumi, sin filete, con el aviso en 0.75rem tinta tenue de sumi. Foco en blanco de pliegue.

### Portada · Botón de pliegue (hero)
El único botón relleno de la portada: blanco de pliegue con texto sumi en 500, 48px de alto, 20px de margen lateral, 2px de radio, flecha Phosphor de 16px en negrita que avanza 2px al pasar, y la sombra de papel del botón. Sube 1px al pasar y baja 1px al pulsar (200ms). "Empezar el lab 1" o, con un lab a medias, "Continuar: Lab N. Título" (corto en el teléfono); entonces aparece al lado "Abrir el lab 1" como enlace discreto subrayado en crease, que ocupa su sitio oculto hasta leer el progreso.

### Portada · Botón con borde (cierre)
Mismo tamaño y radio, con borde de 1px en blanco de pliegue y texto en blanco de pliegue; al pasar se rellena de blanco de pliegue con texto sumi. Lleva al lab 1.

### Portada · Enlace de verbo
"Abrir la referencia" y "Ver la ruta completa" bajo Aprender y Practicar: texto en 500 en la tinta de la crema con subrayado bermellón de 2px separado 6px y la flecha Phosphor de 16px, con un dato al lado en 0.875rem tinta tenue.

### Portada · Hoja con consola (firma)
Un cuadrado de washi bermellón (34rem como máximo) con fibra, guías de pliegue y la sombra de papel de la hoja. Dentro, con 7 % de margen: la tarea real del lab con su casilla de 20px (borde de blanco de pliegue; cumplida, rellena de blanco con la marca en sumi), la línea de verificación reservada en 0.8125rem y, abajo, la consola en Geist Mono escrita en blanco de pliegue con cursor de bloque. Se teclea la regla de NAT a ritmo irregular, el motor la ejecuta y la casilla se marca; lo anuncia una región viva. Se reproduce una vez al entrar en pantalla y con movimiento reducido muestra el estado final. Pie tras un filete de pliegue con el texto en 0.8125rem y "Repetir" discreto.

### Portada · Columna de pasos (firma)
Lista ordenada 01 a 07 tras un filete vertical, cada paso un botón que salta al punto del viaje donde ocurre: numeral en Jost tabular y nombre en versalitas. El activo va en tinta, con aria-current="step", y el punto dorado de 9px montado sobre el filete (crece de 0 a 1 en 300ms); el resto en tinta tenue, tinta media al pasar. Es el mismo diagrama en el hero (paso 01 activo, desde 1024px) y junto al escenario del viaje.

### Portada · Viaje del paquete (firma)
Escenario fijo sobre sumi en una sección de 640vh. Un único bucle de requestAnimationFrame, despertado por el scroll y el cambio de tamaño, escribe variables CSS en el escenario (los tres pliegues, tamaño, escala, posición, NAT, etiqueta, altura de la red, avance de la tinta y posición de cada estación) y su etapa; React solo guarda el paso activo y re-renderiza cuando cambia. Fases: plana, tres pliegues, a R1, NAT, al ISP, al destino y despliegue en orden inverso. La red es un cable de 1px en crease que se entinta en blanco de pliegue (2px) al paso de la pieza; las estaciones pasan a blanco de pliegue al ser alcanzadas (400ms). La etiqueta del paquete, en blanco de pliegue a su lado, tacha el remite viejo y muestra el nuevo en la tinta del revés según avanza la NAT. Abajo, "0N / 07" en versalitas y el paso en palabras. Para lectores de pantalla, el viaje entero va en una lista oculta.

### Portada · Lista quieta del viaje
El mismo viaje como lista de siete pasos entre filetes, con numeral Jost en tinta tenue y el nombre en 600. La muestran el CSS con movimiento reducido o una pantalla de 479px de alto o menos, y la columna de pasos salta a ella cuando el escenario está oculto.

### Portada · Aprender y Practicar
Las dos páginas crema de la hoja desplegada. Aprender: el verbo, la entradilla en tinta media y, por cada tarea, su nombre en 500 y las citas IOS y RouterOS, cada una rotulada en versalitas tenues y escrita en Geist Mono sobre sumi con 2px de radio, prompt en la tinta tenue de sumi. Practicar: el verbo, la entradilla, el nombre de la ruta en versalitas y la fila de la ruta compactada (numeral Jost 300, título en 500 con toda la fila como enlace, minutos en 0.8125rem tinta tenue y casilla de 18px: cumplida en bermellón con la marca en blanco de pliegue, pendiente con borde de control sobre crema).

## Do's and Don'ts

Las dos listas siguientes son del cuaderno (lab, rutas, referencia); la portada tiene las suyas al final.

### Do:
- **Do** separar zonas y filas con filetes de 1px (rule) y nada más.
- **Do** poner el color de estado en la casilla de la tarea: verde (done) cumplida, ámbar (warn) en regresión.
- **Do** mantener numerales, progreso, contadores y el título de lab completado en tinta, sin color.
- **Do** usar control (#8a929a) para bordes de casillas vacías y controles, para pasar 3:1 con un filete de 1px.
- **Do** citar código en tareas y pistas con Geist 500 sobre un chip de filete.
- **Do** citar bloques de consola sobre grafito de consola, en Geist Mono y con el prompt en tinta tenue.
- **Do** usar como mucho un botón principal relleno de tinta por superficie de persuasión, y el principal con borde (gris de control) en las superficies de trabajo.
- **Do** mantener cada dato de los metadatos sin salto interno y cortar la línea entre datos.
- **Do** usar 2px de radio en todo lo que tenga esquina.
- **Do** rotular la topología como figura numerada con su pie, con interfaces y direcciones en un solo bloque en cada extremo de cable.
- **Do** contraescalar el texto de la figura para que mida 12px (13px los ids) en pantalla a cualquier zoom, y mantener 2px de radio en pantalla.
- **Do** distinguir el medio por el trazo: continuo para cable, discontinuo (6 4) para wifi; lo caído en filete marcado.

### Don't:
- **Don't** usar rojo para un objetivo; el rojo es solo de acciones destructivas y de la salida del equipo en la consola.
- **Don't** usar Geist Mono fuera de superficies de consola: nunca en prosa, rótulos ni en el marco de la interfaz.
- **Don't** poner un segundo botón relleno en una pantalla ni un botón relleno en las superficies de trabajo (lab, rutas).
- **Don't** construir la pantalla como un IDE de tres paneles con pestañas de archivo, árbol de ficheros o carril de iconos.
- **Don't** envolver secciones en tarjetas, fondos elevados o sombras.
- **Don't** añadir degradados, efectos de cristal ni un color de acento de marca.
- **Don't** colorear el anillo de foco con un color de estado.
- **Don't** bajar de 0.75rem en texto de interfaz.
- **Don't** mostrar tráfico ni contadores de interfaz en la figura.

### Portada: grulla plegada
Solo para `/[locale]`. Las listas de arriba siguen mandando en lab, rutas y referencia.

#### Do:
- **Do** declarar la superficie de cada banda (on-washi, on-sumi, on-cream) y dejar que los componentes hereden su tinta.
- **Do** poner el oro (gold) solo en el punto del paso activo.
- **Do** usar un solo botón relleno de blanco de pliegue, en el hero; el del cierre va con borde.
- **Do** mantener el texto sobre fibra en 4.5:1 o más en el percentil 95 del papel; sobre bermellón con fibra, solo blanco de pliegue (y tinta media del bermellón sobre bermellón hondo).
- **Do** usar mono solo en la consola de la hoja y en las citas de consola.
- **Do** usar 2px de radio en controles y piezas pequeñas, y el papel a escuadra.
- **Do** mover el viaje escribiendo variables CSS desde un único bucle de requestAnimationFrame, con React atento solo al paso activo.
- **Do** dejar que el CSS muestre la lista quieta con movimiento reducido o 479px de alto o menos, antes de hidratar.
- **Do** dibujar los equipos del viaje con Phosphor en peso light: Desktop, Network, Cloud y HardDrives.
- **Do** generar cualquier raster de papel con `apps/web/scripts/washi-texture.mjs` y semilla fija.

#### Don't:
- **Don't** usar Jost, los tokens de washi ni sus sombras fuera de la portada.
- **Don't** usar el oro en texto, bordes, botones o fondos.
- **Don't** poner tinta tenue sobre bermellón con fibra.
- **Don't** usar las versalitas como antetítulo encima de un titular.
- **Don't** dar sombra a bandas, listas o citas; solo al papel y a lo que se apoya en él.
- **Don't** usar imágenes de terceros ni fotografía.
