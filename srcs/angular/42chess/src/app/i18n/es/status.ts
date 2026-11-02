import type { Translation } from '../../core/i18n/i18n';

export const status: Translation['status'] = {
  eyebrow: 'Estado del servicio',
  title: '¿Funciona 42 Chess?',
  intro:
    'Lo que el servidor alcanza ahora mismo. Esta página se actualiza cada {{seconds}} segundos mientras está abierta.',
  checking: 'Comprobando los servicios…',
  services: 'Servicios',
  unknown: 'Desconocido',
  operational: 'Operativo',
  down: 'Caído',
  backups: 'Copias de seguridad',
  backupNote: 'Se hace una copia cada hora y se conservan las de las últimas 24 horas.',
  checkedAt: 'Comprobado a las {{time}}',
  checkingShort: 'Comprobando…',
  again: 'Comprobar de nuevo',
  list: {
    api: {
      name: 'Web y API',
      role: 'Páginas, inicio de sesión y partidas en directo',
    },
    database: {
      name: 'Base de datos',
      role: 'Cuentas, partidas, problemas y mensajes',
    },
    'chess-engine': {
      name: 'Motor de reglas',
      role: 'Comprueba cada jugada de cada partida',
    },
    bot: {
      name: 'Rival informático',
      role: 'Partidas contra el ordenador',
    },
    mail: {
      name: 'Correo',
      role: 'Correos de verificación y de contraseña',
    },
  },
  unreachable: {
    title: '42 Chess no responde',
    text: 'El servidor no responde: las partidas, el inicio de sesión y los problemas no están disponibles.',
  },
  outage: {
    title: 'Caída grave',
    text: 'La base de datos no responde: no funciona nada que necesite una cuenta.',
  },
  degraded: {
    title: 'Algunos servicios están caídos',
    text: 'La web funciona, salvo lo que depende de los servicios marcados abajo.',
  },
  ok: {
    title: 'Todo funciona',
    text: 'Todo funciona con normalidad.',
  },
  noBackup: 'Todavía no se ha registrado ninguna copia de seguridad.',
  lastBackup: 'Última copia {{ago}}.',
  lateBackup: 'Con retraso: la última copia fue {{ago}}.',
  ago: {
    now: 'hace menos de un minuto',
    day: {
      one: 'hace {{count}} día',
      other: 'hace {{count}} días',
    },
    hour: {
      one: 'hace {{count}} hora',
      other: 'hace {{count}} horas',
    },
    minute: {
      one: 'hace {{count}} minuto',
      other: 'hace {{count}} minutos',
    },
  },
};
