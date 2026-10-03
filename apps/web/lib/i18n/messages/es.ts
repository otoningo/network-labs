/**
 * Textos de la interfaz en español (idioma fuente). Solo cadenas: viajan del
 * servidor al cliente. `{x}` se sustituye y los objetos `{ one, other }` se
 * eligen con las reglas de plural del idioma (ver ../format.ts).
 */
export const es = {
  meta: {
    title: 'nos-labs',
    description: 'Labs en el navegador para practicar el CLI de sistemas operativos de red.',
    labTitle: '{title} · nos-labs',
  },
  app: {
    name: 'nos-labs',
    skipToConsole: 'Saltar a la consola',
    language: 'Idioma',
    languageNames: { es: 'Español', en: 'English' },
    disclaimer:
      'Proyecto independiente con fines educativos. No está afiliado a MikroTik, Huawei, Cisco ni a ningún otro fabricante; los nombres de productos pertenecen a sus dueños.',
  },
  lab: {
    paths: { 'mikrotik-desde-cero': 'MikroTik desde cero' },
    labNumber: 'Lab {n}',
    difficulty: { beginner: 'Inicial', intermediate: 'Intermedio', advanced: 'Avanzado' },
    minutes: '{n} min',
    progress: { one: '{done} de {total} tarea', other: '{done} de {total} tareas' },
    progressLabel: 'Progreso del lab',
    tasks: 'Tareas',
    taskNumber: 'Tarea {n}',
    status: {
      done: 'Cumplida',
      pending: 'Pendiente',
      regressed: 'Se cumplía y ya no',
    },
    regressedNote: 'Algo que cambiaste después la deshizo.',
    hints: {
      show: 'Pista',
      next: 'Otra pista',
      count: '{n} de {total}',
      none: 'No quedan más pistas para esta tarea.',
      label: '{action} para la tarea {n}',
    },
    figure: 'Fig. 1',
    figureCaption: 'Topología del lab',
    figureNote: 'Las direcciones de cada puerto siguen a la red en vivo.',
    console: 'Consola',
    consoleOf: 'Consola de {device}',
    device: 'Equipo',
    finished: {
      title: 'Lab completado',
      body: 'Todas las tareas se cumplen en la red. Esto es lo que acabas de hacer:',
    },
    reset: 'Reiniciar lab',
    cancel: 'Cancelar',
    resetConfirm: '¿Reiniciar el lab? Se pierde la configuración y el progreso de este lab.',
    restored: { one: 'Sesión restaurada: {n} comando', other: 'Sesión restaurada: {n} comandos' },
    views: { tasks: 'Tareas', figure: 'Topología', console: 'Consola' },
    viewsLabel: 'Zonas del lab',
    resizeTasks: 'Redimensionar tareas y área de trabajo',
    resizeFigure: 'Redimensionar topología y consola',
    loadError: 'El lab no pudo cargar: {detail}',
  },
  terminal: {
    label: 'Terminal de {device}. Escribe comandos y pulsa Enter.',
    keys: 'Tab completa, ? muestra ayuda, flechas arriba y abajo recorren el historial, Ctrl+X activa el modo seguro y Ctrl+C cancela la línea. Para salir de la terminal pulsa Esc y después Tab, o Mayús+Tab.',
    closed: 'Sesión cerrada. Pulsa Enter para volver a conectar.',
    intro: 'Equipo simulado. ? muestra la ayuda y Tab completa.',
  },
} as const;
