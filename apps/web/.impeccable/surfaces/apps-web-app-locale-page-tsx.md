---
version: 1
slug: "apps-web-app-locale-page-tsx"
primary_target: "apps/web/app/[locale]/page.tsx"
related_targets: []
---

# Portada

Scope: la portada (`/[locale]`). Mode: Persuade. Vuelve al cuaderno de prácticas: mismo marco, tokens y componentes que lab, rutas y referencia (D-043 sustituye el mundo "grulla plegada" de D-041).

Audience: estudiantes que saben IOS y quieren aprender RouterOS (luego VRP y VyOS). Job: ver en segundos que aquí se pasa de IOS a RouterOS y entrar al lab 1 o a la referencia, sin registro. Proof: el motor real (cada traducción se ejecuta en un router simulado y la casilla se marca por lo que hace la red); sin testimonios ni métricas inventadas. Constraints: PRODUCT.md; menú "Aprender" / "Practicar".

Memorable moment: eliges una tarea de IOS, ves su equivalente en RouterOS escribirse en una consola real y la casilla se marca porque la red cambió.

Unresolved: ninguno.

## Direction contract

THESIS: La portada es un traductor que funciona: tareas de IOS a la izquierda del razonamiento, RouterOS en vivo a la derecha. Rechaza el hero de marketing con capturas falsas y las tres tarjetas de ventajas.

OWN-WORLD: El cuaderno: grafito en tres escalones, tinta en tres tonos, filetes de 1px, Geist en la interfaz y Geist Mono solo en las consolas, casilla de estado verde como único color, 2px de radio, sin sombras, degradados ni cristal.

STORY: El visitante reconoce los comandos de IOS que ya sabe, ve que en RouterOS son otra sintaxis para lo mismo, entiende que aquí se comprueba lo que hace la red y entra a Practicar (lab 1) o a Aprender (referencia).

FIRST VIEWPORT: Izquierda (5/12): titular de dos líneas en hero 600, la segunda en tinta media, entradilla de una frase de menos de 20 palabras, el único botón relleno de tinta ("Empezar el lab 1" o "Continuar"). Derecha (7/12): Fig. 1, pestañas Nombre · Dirección · Por defecto · NAT (cortas para caber en una línea a 375px; «Ruta» se evita porque en el sitio nombra las rutas de aprendizaje), la fila de tarea con su casilla, la cita IOS y la consola RouterOS que se escribe sola y ejecuta en el motor.

FORM: traductor IOS → RouterOS, quinto de siete en mi lista, seed key b8214cba. Firma: cada pestaña reproduce la traducción en una consola real; con movimiento reducido muestra el estado final.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
