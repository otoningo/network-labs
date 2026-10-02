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
