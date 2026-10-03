# Decisiones técnicas

Registro de decisiones con dos caminos razonables. Cada entrada dice qué se
eligió, qué se descartó y por qué. Las nuevas van al final.

---

## D-001 · Workspaces de npm en vez de pnpm

- **Elegido:** workspaces de npm 11.
- **Descartado:** pnpm (con o sin Turborepo).
- **Por qué:** la máquina de desarrollo no tiene pnpm y Node 26 ya no trae
  corepack, así que usar pnpm obliga a instalar una herramienta global. Con
  cuatro paquetes, `npm run --workspaces` cubre lo necesario y Turborepo no
  aporta nada. Pasar a pnpm después solo cambia el archivo de bloqueo y los
  scripts.

## D-002 · TypeScript 6.0 y no 7.0

- **Elegido:** TypeScript 6.0.3.
- **Descartado:** TypeScript 7 (compilador nativo).
- **Por qué:** `next build` usa la API JavaScript del compilador para revisar
  tipos, y la 7 ya no la expone igual. La 6.0 es la última versión con esa
  API. Se revisará cuando Next soporte la 7 oficialmente.

## D-003 · Biome en vez de ESLint + Prettier

- **Elegido:** Biome (lint y formato en un solo paquete).
- **Descartado:** ESLint + typescript-eslint + Prettier + plugins.
- **Por qué:** una dependencia en vez de unas seis, mucho más rápida, y con la
  regla `noExplicitAny` como error para cumplir "TypeScript sin `any`".

## D-004 · Paquetes internos sin paso de compilación

- **Elegido:** `@nos/core` y `@nos/vendors` exportan su `.ts` fuente; Next los
  transpila con `transpilePackages` y Vitest los ejecuta directamente.
- **Descartado:** compilar cada paquete a `dist/` con tsup o `tsc -b`.
- **Por qué:** sin builds intermedios no hay artefactos desfasados ni
  procesos en modo watch. Nada de esto se publica en npm.

## D-005 · Configuración y estado operativo separados

- **Elegido:** cada dispositivo tiene `config` (lo que escribe el usuario) y
  `oper` (lo que el equipo "vive"). Los drivers solo cambian `config`, y
  siempre mediante `Op` neutrales. La parte derivada de `oper` (rutas, leases,
  ARP, tabla MAC, vecinos) la recalcula una función pura, `converge(network)`.
- **Descartado:** que cada comando modifique directamente tablas operativas.
- **Por qué:** así la validación compara estado y no comandos, y cualquier
  camino válido llega al mismo resultado. Además los cambios son fáciles de
  probar y deshacer (safe mode, `/undo`, restaurar un backup).

## D-006 · Ítems en arreglos ordenados con `ItemId` numérico

- **Elegido:** todas las colecciones son arreglos ordenados de ítems con un
  `id` numérico que asigna un contador por dispositivo.
- **Descartado:** objetos indexados por id o `Map`.
- **Por qué:** el orden importa (reglas de firewall, numeración de `print`) y
  los arreglos se serializan a JSON tal cual para guardar el progreso. El
  driver decide cómo mostrar el id (`*1A` en RouterOS).

## D-007 · El nombre de una interfaz es un dato, no su identidad

- **Elegido:** enlaces, referencias y predicados apuntan al `ItemId`.
- **Por qué:** en RouterOS es habitual renombrar `ether1` a `ether1-wan`, y eso
  no debe romper la topología ni la validación de un lab.

## D-008 · El modelo guarda valores explícitos; los defaults son del driver

- **Por qué:** cada fabricante tiene sus propios valores por defecto (tiempo de
  lease, MTU, distancia). El driver los rellena al crear un ítem, así que
  `/export` sabe qué omitir y el núcleo no conoce a ningún fabricante.

## D-009 · Política de referencias colgantes elegida por el driver

- **Elegido:** `applyOp` recibe `danglingRefs: 'reject' | 'orphan'`.
- **Por qué:** RouterOS deja que borres una interfaz en uso y marca lo que
  dependía de ella como inválido (flag `I`); VRP rechaza la operación. Ambos
  comportamientos son reales y ninguno pertenece al núcleo.

## D-010 · Reloj simulado inyectado

- **Por qué:** el núcleo nunca lee `Date.now()`. El tiempo avanza con `tick()`.
  Las pruebas son deterministas y la UI decide cómo mapear tiempo real a
  tiempo simulado.

## D-011 · Hardware genérico y MAC de administración local

- **Elegido:** placas con nombres genéricos (`sim-r5w`) y MAC `02:xx:...`
  generadas de forma determinista a partir del id del dispositivo.
- **Descartado:** modelos comerciales reales y prefijos OUI de fabricantes.
- **Por qué:** no usamos marcas ajenas como propias y los identificadores
  asignados a un fabricante no nos pertenecen.

## D-012 · Contraseñas de usuario: solo se guarda si existen

- **Por qué:** el usuario puede teclear en la terminal una contraseña que usa en
  otros sitios. Guardamos `hasPassword: boolean`, nunca el texto. Las claves
  wifi sí se guardan porque las define el lab y hay que compararlas.

## D-013 · Solo IPv4 en la v1

- **Por qué:** los 12 labs iniciales no necesitan IPv6. Quedan fuera también
  OSPF/BGP, VPN, PPPoE, colas, mangle y la simulación de bucles STP. El modelo
  admite añadirlos sin rehacerlo.

## D-014 · Trazado de paquetes como base de las validaciones de conectividad

- **Elegido:** `trace()` simula el recorrido completo (L2, ruteo, filtro,
  NAT y conntrack) en ambos sentidos. Predicados como `reachable` o
  `natSourceIs` lo usan.
- **Descartado:** comprobar piezas sueltas de configuración ("hay una regla
  masquerade").
- **Por qué:** comprobar piezas aprueba configuraciones que no funcionan y
  rechaza soluciones válidas que el autor del lab no previó.

## D-015 · Comportamientos dependientes del sistema en `Device.traits`

- **Elegido:** cada dispositivo lleva rasgos de comportamiento (si reenvía
  paquetes, en qué orden asigna IPs de un pool) que fija su plataforma al
  crearlo.
- **Descartado:** pasar una tabla de comportamientos por fabricante a cada
  función del motor.
- **Por qué:** el estado queda autocontenido y serializable, y el motor no
  necesita saber qué fabricante es.

## D-016 · Labs en YAML, validados con Zod y compilados a JSON

- **Elegido:** YAML para escribir, con un esquema Zod que valida y genera un
  JSON Schema para el autocompletado del editor. Los textos en español e
  inglés van juntos en el mismo archivo.
- **Descartado:** JSON a mano (sin comentarios, mucho ruido de comillas) y labs
  como módulos TypeScript (mezclan contenido con código).
- **Por qué:** los labs tienen texto largo en dos idiomas y conviene comentarlos.
  El parser de YAML solo corre al compilar y en las pruebas (entrada aparte
  `@nos/core/lab-yaml`), así que no llega al navegador.
- La configuración inicial de los equipos de fabricante se escribe en su
  propia sintaxis y la ejecuta el driver al cargar el lab. Si el driver no la
  entiende, la prueba del lab falla: los labs también prueban a los drivers.

## D-017 · Contrato de driver ampliado respecto al brief

- `complete(input, cursor, ctx)` recibe el contexto: el autocompletado depende
  del menú actual y de los nombres de interfaz del equipo.
- `key(chord, ctx)` traduce combinaciones como Ctrl+X (safe mode) a intenciones.
- `describeError(error, ctx)` redacta los errores con la voz del fabricante,
  tanto los de sintaxis como los códigos del núcleo.
- `apply` recibe y devuelve la red completa, porque acciones como `ping` o
  `torch` dependen de otros equipos y dejan efectos (contadores, caché DNS).

## D-018 · Estado operativo en arreglos, no en diccionarios

- **Elegido:** `oper.interfaces` y `oper.dhcpClients` son arreglos con el id
  dentro de cada entrada (el plan aprobado los mostraba como `Record`).
- **Por qué:** las claves numéricas de un objeto se convierten en texto al
  serializar y se pierde el tipo nominal. Los arreglos se guardan y comparan
  sin conversiones.

## D-019 · Internet emulado responde solo por IPs públicas

- **Elegido:** el equipo `internet` responde por cualquier IP pública del
  escenario y descarta las privadas (RFC 1918, CGNAT, link-local).
- **Por qué:** así un lab sin NAT falla igual que en la realidad: el paquete
  sale, pero la respuesta no tiene ruta de vuelta a 192.168.x.x. Si Internet
  respondiera a todo, se aprobarían configuraciones que no funcionan.

## D-020 · Dependencias y su justificación

Cada paquete instalado, con versión fija (`--save-exact`) para builds reproducibles.

| Paquete | Dónde | Para qué |
|---|---|---|
| `typescript` 6.0 | raíz (dev) | Tipado estricto en todo el monorepo (ver D-002). |
| `vitest` + `@vitest/coverage-v8` | raíz (dev) | Pruebas pedidas en el brief y umbral de cobertura del núcleo. `vite` llega como dependencia par de Vitest. |
| `@biomejs/biome` | raíz (dev) | Lint y formato; prohíbe `any` (ver D-003). |
| `zod` | `@nos/core` | Esquema de labs, mensajes de error legibles y JSON Schema para editores. Servirá también para validar lo que se lea de localStorage. |
| `yaml` | `@nos/core` | Leer labs en YAML. Solo en compilación y pruebas (ver D-016). |
| `next`, `react`, `react-dom` | `@nos/web` | Stack pedido en el brief. |
| `@types/react`, `@types/react-dom`, `@types/node` | `@nos/web` (dev) | Tipos que exige Next.js con TypeScript. El núcleo no los usa: no depende de Node ni del DOM. |

Tailwind, xterm.js, Zustand y la librería de iconos se instalarán en la fase 3,
cuando haya interfaz que los use, en lugar de en la fase 1 como decía el plan.

## D-021 · Wifi con el menú `/interface wifi` (paquete actual de v7)

- **Elegido:** `/interface wifi` con interfaces `wifi1..N` y propiedades
  `configuration.ssid`, `configuration.mode`, `channel.band`,
  `security.authentication-types` y `security.passphrase`.
- **Descartado:** el menú antiguo `/interface wireless` (`wlan1`).
- **Por qué:** es el que traen los equipos nuevos con v7. Si un lab necesitara
  el antiguo, se puede añadir como otra vista sobre el mismo modelo neutral.

## D-022 · Formato de salida de referencia: RouterOS v7 reciente

- Prompt con la ruta en forma v7 (`[admin@MikroTik] /ip/address>`), línea
  `Columns:`, leyenda de flags en mayúsculas y solo con los flags presentes,
  rutas dinámicas sin número y `print` de firewall en formato detalle.
- Se aceptan las dos formas de escribir rutas: `/ip address print` y
  `/ip/address/print`, más abreviaturas únicas como hace el equipo.
- La salida busca ser verosímil, no idéntica byte a byte: no copiamos
  documentación ni salidas reales, se escribió a partir de su descripción pública.

## D-023 · Mensajes de error centralizados

- Todos los textos de error viven en `errors.ts`, traducidos desde códigos
  estables (del parser y del núcleo). Algunos están confirmados con la
  documentación pública («input does not match any value of interface»,
  «expected end of command»); el resto son aproximaciones que se pueden
  corregir en un solo lugar.

## D-024 · Números de ítem sin print previo

- **Elegido:** si el usuario usa `set 0` sin haber hecho `print` en ese menú,
  se numera como si hubiera hecho un `print` completo.
- **Descartado:** exigir un `print` previo.
- **Por qué:** evita un tropiezo frustrante al aprender, y tras cualquier
  `print` (incluido `print where`) se usa exactamente la numeración mostrada.

## D-025 · Varias órdenes en una línea se ejecutan en secuencia

- Con `;`, cada comando se analiza al ejecutarse, con el estado que dejó el
  anterior (por ejemplo, crear un bridge y añadirle puertos en la misma línea).
  Import y los scripts de arranque de los labs siguen el mismo camino.

## D-026 · Permisos por grupo de usuario

- `read` solo consulta (print, ping, :resolve, torch, traceroute, export sin
  archivo); `write` cambia la configuración salvo usuarios, reset y carga de
  backup; `full` lo puede todo. El error es `failure: not enough permissions (9)`.
- Un usuario que no existe en `/user` tiene acceso total: así funcionan las
  pruebas y los scripts de arranque de los labs, que no inician sesión.
- Diferencia conocida: en RouterOS real el grupo `read` puede reiniciar; aquí no.

## D-027 · DNS por DHCP cuando la red no define servidores

- Rasgo de plataforma `dhcpDnsFallback`: si una red DHCP no tiene
  `dns-server`, el servidor entrega sus propios DNS (configurados y
  dinámicos). RouterOS lo activa; hosts, Internet y la plataforma de pruebas no.

## D-028 · Acceso de gestión por capa 2 como ajuste neutral

- `l2Access` guarda qué lista de interfaces admite gestión por MAC (consola y
  herramienta gráfica). En RouterOS se ve como `/tool mac-server` y
  `/tool mac-server mac-winbox`; otros fabricantes pueden mapearlo o ignorarlo.

## D-029 · Notas del sistema en print

- Una fila puede llevar una `note` (por qué un ítem es inválido) que print
  muestra como `;;;` antes del comentario. No se exporta ni se edita, para no
  mezclarse con el comentario del usuario.

## D-030 · Dependencias de la interfaz (fase 3)

Cada una cubre algo que no conviene escribir a mano:

- `tailwindcss` + `@tailwindcss/postcss` (v4): pedido en el brief; las
  utilidades leen los tokens de `globals.css`.
- `@xterm/xterm` + `@xterm/addon-fit`: pedido en el brief. xterm solo pinta;
  la edición de línea, el historial, Tab y `?` son nuestros.
- `zustand`: pedido en el brief; un store por pantalla de lab (D-033).
- `react-resizable-panels`: separadores con rol `separator`, teclado y límites
  de tamaño ya resueltos. Escribirlo a mano es fácil de hacer mal en accesibilidad.
- `@phosphor-icons/react`: una sola familia de iconos, sin dibujar SVG a mano.
- Descartado `next-intl`: dos idiomas y cadenas simples se cubren con un
  diccionario tipado y `Intl.PluralRules` (`apps/web/lib/i18n`).

## D-031 · Tokens, tipografía y estado

- Todos los colores y tamaños de texto son variables CSS en `:root`, expuestas
  a Tailwind con `@theme inline`. Oscuro único en la v1.
- La casilla de cada tarea es lo único que lleva color de estado: verde
  cumplida, ámbar "se cumplía y ya no". Numerales, barra de progreso, contador
  de la pestaña y título de lab completado son monocromos. El foco usa la
  tinta, no un acento, para no confundirse con un estado.
- No hay estado rojo de objetivo: un objetivo no "falla", solo está pendiente o
  en regresión. Los errores son del equipo y salen en la consola con su voz. El
  rojo queda para acciones destructivas (reiniciar el lab).
- Las casillas vacías y los controles usan `--color-control` (5,2:1 sobre el
  fondo): el filete de 1px se suaviza al pintarse y debe seguir por encima del
  3:1 de WCAG 1.4.11. Los numerales de tarea tienen un solo tono en todo estado.
- Geist para la interfaz; Geist Mono solo en la consola. El código citado en
  tareas y pistas va en la misma sans con un fondo, sin mono.
- La ayuda de uso de la consola ("? muestra la ayuda...") es de la interfaz y se
  traduce; la salida del equipo simulado queda en su idioma, como en el real.

## D-032 · Progreso: se guarda lo escrito, no la red

- `ProgressRepository` es asíncrono (load, save, list, clear) para cambiar
  localStorage por Supabase sin tocar la UI.
- Se guardan las líneas ejecutadas por equipo, las pistas y cuándo se cumplió
  cada objetivo. Al abrir el lab se vuelven a ejecutar las líneas. La red no se
  serializa: así un cambio del motor no deja progreso corrupto.
- Lo leído del almacenamiento se valida antes de usarlo y los errores de cuota
  o de almacenamiento bloqueado no rompen el lab.

## D-033 · Estado del lab y objetivos en vivo

- Un store de Zustand por pantalla, creado con el lab. Tras cada comando se
  evalúan todos los objetivos contra la red.
- Un objetivo tiene tres estados: pendiente, cumplido y "se cumplía y ya no"
  (regresión). El lab se da por completado la primera vez que todos se cumplen
  a la vez.
- Los labs se leen del YAML en el servidor al compilar; al cliente llega el
  objeto validado.

## D-034 · Evidencia por objetivo

- El núcleo devuelve, para cada predicado, lo que la red reporta hoy como datos
  neutros (`evidence()`): direcciones, rutas, flujos con su motivo de fallo y
  el origen visto tras NAT, concesiones, wifi, DNS, archivos, ajustes y las
  condiciones de un conteo. La interfaz lo redacta en es/en.
- Se muestra bajo las tareas cumplidas o en regresión, con un mismo patrón
  ("equipo: dato = valor"), como el paso de verificación de una guía.

## D-035 · Comparar configuraciones sin los ids internos

- `configMatches` compara cada id por su colección y posición. Importar un
  export tras un reset deja la misma configuración con otros ids y cuenta como
  restaurada. Añadir un ítem en otra colección no altera una comparación con
  `scope`.

## D-036 · Lienzo de topología propio, sin dependencia

- SVG con pan y zoom propios (0,5 a 3) en vez de React Flow: el diagrama es de
  solo lectura salvo elegir consola, y así no se suma una dependencia.
- El texto del diagrama no escala con el zoom (12 px y 13 px en pantalla);
  escala la geometría. Cada extremo de cable es un bloque: nombre del puerto y
  sus direcciones del mismo lado.
- Nunca se muestran flujos ni contadores de tráfico: el lab de Torch consiste
  en descubrirlos.
- Límite conocido: el lab 12 en un móvil de 375 px no cabe sin solapes a ese
  tamaño de texto; se ajusta más ancho que el panel y se desplaza.

## D-037 · Contenido de la ruta "MikroTik desde cero"

- Doce labs en `content/labs/routeros/`, cada uno con su batería que lo
  resuelve por la CLI y prueba errores típicos (`content-*.test.ts`).
- Sin `/queue` en el simulador, el lab de Torch bloquea al equipo que más
  consume en vez de limitarlo. El asistente `/ip dhcp-server setup` no se
  simula y ninguna pista lo menciona.
