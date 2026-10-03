import type { Messages } from '../format';

/** English UI strings. Must cover every key of the Spanish source (checked by the type). */
export const en: Messages = {
  meta: {
    title: 'nos-labs',
    description: 'Browser labs to practice the CLI of network operating systems.',
    labTitle: '{title} · nos-labs',
  },
  app: {
    name: 'nos-labs',
    skipToConsole: 'Skip to the console',
    language: 'Language',
    languageNames: { es: 'Español', en: 'English' },
    disclaimer:
      'Independent educational project. Not affiliated with MikroTik, Huawei, Cisco or any other vendor; product names belong to their owners.',
  },
  lab: {
    paths: { 'mikrotik-desde-cero': 'MikroTik from scratch' },
    labNumber: 'Lab {n}',
    difficulty: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
    minutes: '{n} min',
    progress: { one: '{done} of {total} task', other: '{done} of {total} tasks' },
    progressLabel: 'Lab progress',
    tasks: 'Tasks',
    taskNumber: 'Task {n}',
    status: {
      done: 'Done',
      pending: 'Pending',
      regressed: 'Was done, no longer',
    },
    regressedNote: 'Something you changed afterwards undid it.',
    hints: {
      show: 'Hint',
      next: 'Another hint',
      count: '{n} of {total}',
      none: 'No more hints for this task.',
      label: '{action} for task {n}',
    },
    figure: 'Fig. 1',
    figureCaption: 'Lab topology',
    figureNote: 'Each port shows its live addresses.',
    console: 'Console',
    consoleOf: '{device} console',
    device: 'Device',
    finished: {
      title: 'Lab complete',
      body: 'Every task holds on the network. Here is what you just did:',
    },
    reset: 'Reset lab',
    cancel: 'Cancel',
    resetConfirm: 'Reset the lab? This lab’s configuration and progress will be lost.',
    restored: { one: 'Session restored: {n} command', other: 'Session restored: {n} commands' },
    views: { tasks: 'Tasks', figure: 'Topology', console: 'Console' },
    viewsLabel: 'Lab areas',
    resizeTasks: 'Resize tasks and work area',
    resizeFigure: 'Resize topology and console',
    loadError: 'The lab could not load: {detail}',
  },
  terminal: {
    label: '{device} terminal. Type commands and press Enter.',
    keys: 'Tab completes, ? shows help, up and down arrows walk the history, Ctrl+X toggles safe mode and Ctrl+C cancels the line. To leave the terminal press Esc and then Tab, or Shift+Tab.',
    closed: 'Session closed. Press Enter to reconnect.',
    intro: 'Simulated device. ? shows help and Tab completes.',
  },
};
