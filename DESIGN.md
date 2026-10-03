---
name: nos-labs
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
typography:
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
rounded:
  sm: "2px"
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
components:
  top-bar:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    height: "48px"
    padding: "0 20px"
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
---

# Design System: nos-labs

## Overview

**Creative North Star: "El cuaderno de prácticas que se corrige solo"**

La pantalla de lab es una hoja de ejercicios impresa en grafito: tareas numeradas con su casilla, una figura de topología rotulada "Fig. 1" con su pie y la consola al lado. No es un IDE. No hay pestañas de archivos, árbol de ficheros ni carril de iconos; las zonas se separan con filetes de 1px, no con tarjetas. La densidad es la de una guía de prácticas: mucho aire entre tareas, texto en una medida de lectura y una sola tipografía de interfaz.

El color es casi todo tinta sobre grafito. El único color con significado es el de estado, y vive en la casilla de cada tarea (verde cumplida, ámbar "se cumplía y ya no"). Numerales, progreso de la barra, contador de la pestaña y título de lab completado son monocromos. El rojo no es un estado de objetivo: un objetivo no falla, está pendiente o en regresión; el rojo queda para la confirmación destructiva de reiniciar.

Es una herramienta de ingeniería, no una landing: oscuro único, sin degradados, sin cristal, sin sombras. La monoespaciada existe solo dentro de la consola; lo que se cita de la consola en tareas y pistas va en la misma sans con un fondo.

**Key Characteristics:**
- Grafito casi negro en tres escalones (consola, fondo, cajas de la figura) y tinta blanco papel en tres tonos.
- Filetes de 1px como única estructura; nada de tarjetas ni sombras.
- Numerales de tarea grandes y ligeros, en un solo tono en todo estado.
- La casilla de estado es el portador del color de estado.
- Geist en la interfaz, Geist Mono solo en la consola.
- Esquinas casi rectas (2px) en todo.

## Colors

Grafito neutro casi negro con tinta fría; el color saturado está reservado al estado y nunca decora.

### Primary
No hay acento de marca. La jerarquía la hace la tinta (ink, ink-muted, ink-faint), y el foco usa la misma tinta (focus) para no confundirse con un estado.

### Secondary
- **Verde de casilla cumplida** (done): relleno de la casilla de una tarea cumplida, con la marca en el color del fondo. Dentro de la consola, el verde ANSI se reduce a este token.
- **Ámbar de regresión** (warn): relleno de la casilla de una tarea que se cumplía y ya no, y la nota corta de regresión bajo el enunciado de esa misma tarea.

### Tertiary
- **Rojo destructivo** (error): solo el borde y el texto del botón que confirma reiniciar el lab, con su fondo tenue (error-quiet) al pasar el puntero. En la consola, el rojo ANSI se reduce a este token. Nunca marca un objetivo.

### Neutral
- **Grafito de fondo** (ground): fondo de la pantalla, de la hoja y de la figura.
- **Grafito de hoja** (sheet): relleno de las formas de equipo en la figura, del panel de detalle (inspector) y del enlace "saltar a la consola".
- **Grafito de consola** (console): el escalón más oscuro, solo la consola y su franja.
- **Filete** (rule): divisiones entre zonas, filas de tareas, barra superior, pie, enlace al siguiente lab; borde del grupo de zoom; fondo del código citado; fondo del botón de icono al pasar.
- **Filete marcado** (rule-strong): separador al pasar el puntero, bordes de equipo en reposo, cables y asociaciones caídos, borde del inspector, botones de zoom deshabilitados, selección de texto, barras de desplazamiento.
- **Gris de control** (control): borde de casillas vacías, segmentos de progreso pendientes, cables y asociaciones wifi activos de la figura y borde del equipo cuyo detalle se muestra. Está en 5,2:1 sobre el fondo porque el filete de 1px se suaviza al pintarse y debe seguir por encima de 3:1 (WCAG 1.4.11).
- **Tinta** (ink): texto principal, enunciados, título, pestaña activa, anillo de foco, borde del equipo activo, id de equipo en la figura, enlace al siguiente lab.
- **Tinta media** (ink-muted): resumen del lab, pistas, encabezado "Tareas", botones discretos, segmentos de progreso cumplidos, nombre de puerto y nombre en vivo en la figura.
- **Tinta tenue** (ink-faint): numerales, metadatos, pie de figura, direcciones y etiquetas de la figura, línea de verificación, botones de zoom, aviso legal, idioma no activo.

### Named Rules
**La Regla de la Casilla.** El color de estado vive en la casilla de la tarea (y en la nota de regresión de esa misma fila). Numerales, progreso, contadores y títulos de lab completado son monocromos.

**La Regla del Rojo Destructivo.** El rojo no es un estado de objetivo. Solo marca una acción que destruye trabajo, y los errores del equipo salen en la consola con su propia voz.

**La Regla del Foco de Tinta.** El anillo de foco es de tinta (2px, separado 2px), nunca de un color de estado.

## Typography

**Display Font:** Geist (con ui-sans-serif, system-ui)
**Body Font:** Geist (con ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono, solo en la consola (con ui-monospace)

**Character:** Una sola sans neutra y técnica para toda la interfaz, con cifras tabulares por defecto; la mono queda encerrada en la terminal para que la consola se lea como otro mundo, el del equipo.

### Hierarchy
- **Display** (600, 1.75rem, 1.25): título del lab al inicio de la hoja, equilibrado (text-balance).
- **Numeral** (300, 2.5rem, 1, tabular): numeral de cada tarea, alineado a la derecha en su columna, en tinta tenue y un solo tono en todo estado.
- **Headline** (600, 1.0625rem): título de la sección "lab completado".
- **Title** (500, 0.9375rem): título del lab en la barra superior; el nombre del producto va en 600 con tracking ajustado.
- **Body** (400, 0.9375rem, 1.55): enunciados de tarea, resumen y explicación final, con medida máxima de 62ch.
- **Body small** (400, 0.875rem): pistas, encabezado "Tareas" (en 600), navegación de la barra, pestañas y botones.
- **Label** (400, 0.8125rem): metadatos (dificultad · minutos), pie de figura, franja de la consola, nota de regresión, línea de verificación, inspector.
- **Fine** (400, 0.75rem): aviso legal del pie. Es el tamaño mínimo de la interfaz.
- **Figura** (Geist 12px, el mismo paso que fine; ids 13px en 600): texto del lienzo de topología, contraescalado para medir siempre lo mismo en pantalla a cualquier zoom.
- **Console** (Geist Mono 13.5px, 1.35): todo lo que pinta la terminal.

La escala va en rem (relación aproximada 1.2) para respetar el zoom del usuario.

### Named Rules
**La Regla de la Mono Encerrada.** Geist Mono solo dentro de la consola. El código citado en tareas y pistas es Geist en peso 500 sobre un chip de filete.

**La Regla del Numeral Callado.** El numeral es grande y ligero, y nunca cambia de color: el estado lo dice la casilla.

**La Regla del Texto Fijo.** En la figura, el zoom escala formas y cables, nunca el texto: rótulos, direcciones, etiquetas y nombre en vivo miden 12px en pantalla y los ids 13px en 600, a cualquier escala.

## Layout

Tres zonas sobre una rejilla de altura completa (100dvh): barra superior de 48px y, debajo, el banco de trabajo.

- **Escritorio (≥1024px):** paneles redimensionables. Hoja de tareas a la izquierda (400px por defecto, mínimo 300px, máximo 55%). A la derecha, figura arriba (38%, mínimo 120px, plegable) y consola abajo (mínimo 160px). Los separadores son líneas de 1px de filete con zona sensible más ancha; al pasar se marcan, al arrastrar se aclaran y con foco de teclado se vuelven tinta.
- **Por debajo de 1024px:** pestañas Tareas · Topología · Consola, con el contador n/m de tareas en tinta tenue junto a "Tareas". La consola sigue montada aunque su pestaña no esté visible.
- **Barra superior:** la ruta y el número de lab aparecen desde 768px; el texto "n de m tareas" desde 640px; el texto de confirmación de reinicio desde 1024px.
- **Hoja:** consulta de contenedor; padding de 24px (32px cuando el contenedor pasa de 28rem). Las tareas son una rejilla de tres columnas compartidas (numeral, enunciado, casilla) con 16px de separación y 20px de aire vertical por fila, así un cambio de estado no mueve nada.
- **Lienzo de la figura:** ocupa el panel; zoom entre 0.5× y 3× (paso 1.25×, rueda, pellizco, + y −), desplazamiento arrastrando o con flechas (40px) y encuadre (0) que centra con 16px de margen sin pasar de 1.5×. El reparto de equipos se elige para que formas y rótulos no se crucen, con el marco redondeado a 40px para no temblar al arrastrar el separador; en un panel estrecho y vertical (menos de 640px de ancho y más alto que ancho) puede trasponerse. Límite conocido: el lab 12 en un teléfono de 375px encuadra más ancho que el panel y hay que desplazarse.
- **Ritmo:** escala de 4px. Pasos recurrentes: 4, 8, 12, 16, 20, 24, 32, 40 (entre bloques de la hoja) y 48px (antes del pie).

## Elevation & Depth

Plano por completo. No hay ninguna sombra. La profundidad se da con tres escalones de grafito (consola más oscura, fondo, formas de la figura y el inspector más claros) y con filetes de 1px. Lo activo se marca subiendo el filete a tinta, no levantando la superficie; el inspector flota sobre el lienzo solo con su escalón de grafito y un borde de filete marcado.

### Named Rules
**La Regla del Filete.** Las zonas se separan con una línea de 1px, nunca con una tarjeta, un fondo elevado o una sombra.

## Shapes

Esquinas casi rectas: 2px en botones, casillas, chips de código, selector, foco, inspector, grupo de zoom y formas de la figura (2px en pantalla a cualquier zoom). No hay formas redondeadas ni píldoras; la nube de Internet es la única silueta curva y es un pictograma, no una esquina.

La forma de cada equipo dice su papel: router como caja con una muesca arriba (la ranura de un chasis), equipo como caja simple, equipo inalámbrico como caja con dos arcos y un punto, Internet como nube. Los trazos no escalan con el zoom: 1px en reposo, 1.5px en el equipo activo y en los cables.

**La Regla del Trazo que Dice el Medio.** Cable activo: línea continua en gris de control. Asociación wifi activa: discontinua (6 4) en gris de control. Caídos, en filete marcado: cable discontinuo (4 4), wifi punteado (2 4).

## Components

### Buttons
Discretos y tipográficos: casi siempre texto sin caja.
- **Shape:** esquinas de 2px.
- **Discreto (pedir pista):** texto en tinta media con icono de bombilla de 15px, sin fondo; pasa a tinta al pasar el puntero. Alto mínimo 44px en táctil y 32px desde 1024px.
- **Icono (reiniciar):** cuadro de 32px, icono de 16px en tinta tenue; al pasar, fondo de filete y tinta.
- **Destructivo (confirmar reinicio):** borde y texto en rojo destructivo, fondo tenue rojo al pasar. La confirmación ocurre en el sitio, sin ventana modal; el foco salta a ella y Escape la cancela.
- **Hover / Focus:** cambios de color solamente; el foco es el anillo de tinta global.

### Chips
- **Código citado:** Geist 500 a 0.95em, fondo de filete, tinta, 2px de radio, sin salto de línea.

### Inputs / Fields
- **Selector de equipo de la consola:** 28px de alto, fondo de consola, filete de borde que pasa a filete marcado al pasar, texto de 0.8125rem.

### Navigation
- **Barra superior:** 48px, filete inferior. Nombre del producto, ruta / lab n en tinta tenue y media, título del lab, progreso, idioma y reinicio a la derecha.
- **Idioma:** códigos en mayúsculas; el activo en tinta, el resto en tinta tenue.
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

### Siguiente lab
Al final de la sección de lab completado, tras un filete: "Siguiente" en 0.875rem tinta media y el número y título del lab en 500 tinta, subrayado al pasar, con flecha Phosphor de 15px en negrita. Si no hay siguiente, "Era el último lab de la ruta." en 0.875rem tinta media.

### Consola (firma)
Escalón de grafito más oscuro, franja de 40px con "Consola de R1" en 0.8125rem. El tema de xterm se lee de los tokens; la paleta ANSI se reduce a ellos. Cursor de bloque sin parpadeo. Con foco, un anillo de tinta de 2px dibujado por encima del lienzo.

## Do's and Don'ts

### Do:
- **Do** separar zonas y filas con filetes de 1px (rule) y nada más.
- **Do** poner el color de estado en la casilla de la tarea: verde (done) cumplida, ámbar (warn) en regresión.
- **Do** mantener numerales, progreso, contadores y el título de lab completado en tinta, sin color.
- **Do** usar control (#8a929a) para bordes de casillas vacías y controles, para pasar 3:1 con un filete de 1px.
- **Do** citar código en tareas y pistas con Geist 500 sobre un chip de filete.
- **Do** usar 2px de radio en todo lo que tenga esquina.
- **Do** rotular la topología como figura numerada con su pie, con interfaces y direcciones en un solo bloque en cada extremo de cable.
- **Do** contraescalar el texto de la figura para que mida 12px (13px los ids) en pantalla a cualquier zoom, y mantener 2px de radio en pantalla.
- **Do** distinguir el medio por el trazo: continuo para cable, discontinuo (6 4) para wifi; lo caído en filete marcado.

### Don't:
- **Don't** usar rojo para un objetivo; el rojo es solo de acciones destructivas y de la salida del equipo en la consola.
- **Don't** usar Geist Mono fuera de la consola.
- **Don't** construir la pantalla como un IDE de tres paneles con pestañas de archivo, árbol de ficheros o carril de iconos.
- **Don't** envolver secciones en tarjetas, fondos elevados o sombras.
- **Don't** añadir degradados, efectos de cristal ni un color de acento de marca.
- **Don't** colorear el anillo de foco con un color de estado.
- **Don't** bajar de 0.75rem en texto de interfaz.
- **Don't** mostrar tráfico ni contadores de interfaz en la figura.
