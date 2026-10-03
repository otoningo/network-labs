---
version: 1
slug: "apps-web-app-locale-lab-id-page-tsx"
primary_target: "apps/web/app/[locale]/lab/[id]/page.tsx"
related_targets: []
---

# Pantalla de lab

Scope: la pantalla de un lab (`/[locale]/lab/[id]`). Mode: Operate.

Audience: estudiantes que saben IOS y aprenden RouterOS. Job: completar los objetivos del lab en la consola y entender por qué funcionan. Proof: el estado del modelo valida cada tarea en vivo. Constraints: ver PRODUCT.md.

Memorable moment: la casilla de la tarea se marca sola en el instante en que la red lo cumple, sin pulsar "comprobar".

Unresolved: la topología interactiva (fase 4) ocupa por ahora la figura estática; la portada y las rutas son de la fase 5.

## Direction contract

THESIS: El lab es una hoja de ejercicios que se marca sola: tareas numeradas con verificación, una figura de topología y la consola al lado. Rechaza el IDE de tres paneles (pestañas, árbol de archivos, barra de iconos).

OWN-WORLD: Grafito casi negro, texto blanco papel, filetes finos en vez de tarjetas; numerales de tarea grandes y ligeros; la casilla es el único portador de estado (verde cumplido, rojo error, ámbar aviso). La topología se rotula "Fig. 1" con pie.

STORY: El estudiante lee la tarea 1, escribe en la consola, ve la casilla marcarse cuando la red lo hace de verdad, pide una pista solo si se atasca y lee la explicación al final.

FIRST VIEWPORT: Barra de 48px (ruta, título, progreso n/m, idioma). Hoja de tareas a la izquierda (~380px). A la derecha, figura arriba (40%) y consola abajo (60%) con el foco al cargar.

FORM: cuaderno de prácticas, posición 1 de mi lista, seed key ccf92178.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
