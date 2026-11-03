import type { Translation } from '../../core/i18n/i18n';

export const progression: Translation['progression'] = {
  leaderboard: {
    eyebrow: 'Jugadores',
    title: 'Clasificación',
    intro:
      'Todos los jugadores con una partida clasificatoria, de mayor a menor puntuación. Las puntuaciones iguales comparten puesto.',
    howLink: 'Cómo funcionan la puntuación, la XP y los niveles',
    yourRank: 'Tu puesto',
    showMine: 'Ver mi puesto',
    failed: 'No se pudo cargar la clasificación.',
    none: 'Todavía no hay jugadores clasificados.',
    noneHelp: 'Termina una partida clasificatoria para aparecer aquí.',
    play: 'Jugar una partida clasificatoria',
    caption: 'Clasificación, página {{page}} de {{pages}}',
    rank: 'Puesto',
    player: 'Jugador',
    rating: 'Puntuación',
    record: 'Ganadas · Tablas · Perdidas',
    level: 'Nivel',
    you: 'tú',
    loading: 'Cargando la clasificación…',
  },
  stats: {
    rating: 'Puntuación',
    rank: 'Puesto',
    of: ' de {{total}}',
    unranked: 'Sin clasificar',
    level: 'Nivel',
    streak: 'Racha de problemas',
    days: {
      one: 'día, récord {{best}}',
      other: 'días, récord {{best}}',
    },
    failed: 'No se pudieron cargar algunas estadísticas.',
    results: 'Resultados',
    games: 'Partidas',
    played: 'Jugadas',
    won: 'Ganadas',
    drawn: 'Tablas',
    lost: 'Perdidas',
    rated: 'Clasificatorias',
    casual: 'Amistosas',
    computer: 'Ordenador',
    ratedOnly: 'Solo las partidas clasificatorias cambian la puntuación.',
    puzzles: {
      one: '{{count}} problema resuelto al primer intento.',
      other: '{{count}} problemas resueltos al primer intento.',
    },
    progression: 'Progreso',
    earn: 'Las partidas, los problemas y los logros dan XP.',
    how: 'Cómo funciona el progreso',
    achievements: 'Logros',
    unlockedCount: '{{count}} de {{total}} desbloqueados',
    unlocked: 'Desbloqueado el {{date}}',
    progress: 'Progreso: {{name}}',
  },
  rules: {
    eyebrow: 'Progreso',
    title: 'Cómo funciona el progreso',
    intro:
      'Tu puntuación mide tu fuerza frente a otros jugadores. La experiencia (XP) premia todo lo que juegas: sube tu nivel y nunca baja.',
    ratingTitle: 'Puntuación y clasificación',
    start:
      'Todas las cuentas empiezan con 1200. Solo la cambian las partidas clasificatorias contra otros jugadores.',
    elo: 'Ganar a un jugador más fuerte da más que ganar a uno más débil (Elo, K = 32).',
    boardStart: 'La',
    boardLink: 'clasificación',
    boardEnd:
      'muestra a todos los jugadores con al menos una partida clasificatoria, de mayor a menor puntuación. Las puntuaciones iguales comparten puesto.',
    xpFailed: 'No se pudo cargar la tabla de XP. Inténtalo más tarde.',
    xpTitle: 'Experiencia',
    xpCaption: 'XP ganada',
    you: 'Tú…',
    game: 'Ganar, empatar o perder una partida contra un jugador',
    botEasy: 'Ganar o empatar contra el ordenador fácil',
    botMedium: 'Ganar o empatar contra el ordenador medio',
    botHard: 'Ganar o empatar contra el ordenador difícil',
    daily: 'Resolver el problema diario en su día',
    archive: 'Resolver un problema del archivo',
    streak: 'Bonificación por racha, por día de racha',
    streakValue: '+{{bonus}}, hasta +{{cap}}',
    achievement: 'Desbloquear un logro',
    asListed: 'según la lista de abajo',
    gameCounts:
      'Una partida cuenta en cuanto cada bando ha hecho {{moves}} jugadas. Perder contra el ordenador no da nada.',
    firstAttempt:
      'Un problema da XP en tu primer y único intento. Volver a empezarlo lo convierte en práctica, que no da nada.',
    mistakes:
      '{{max}} jugadas erróneas terminan un intento. Una pista reduce a la mitad la XP del problema (por ejemplo, {{full}} pasa a {{half}}); ver la solución termina el intento sin XP.',
    streakTitle: 'Racha de problemas diarios',
    streakText:
      'Resuelve el problema diario en su día, al primer intento, para sumar un día a tu racha. Si te saltas un día o fallas el intento, el siguiente problema diario resuelto empieza una racha nueva. Los días cambian a medianoche UTC.',
    levelsTitle: 'Niveles',
    levelsText: 'Cada nivel necesita un poco más de XP que el anterior.',
    level: 'Nivel {{level}}',
    achievementsTitle: 'Logros',
    badgeOnly: 'Solo insignia',
    loading: 'Cargando las reglas…',
  },
  achievements: {
    FIRST_GAME: {
      name: 'Jugada de apertura',
      description: 'Termina tu primera partida contra otro jugador.',
    },
    FIRST_WIN: {
      name: 'Primera victoria',
      description: 'Gana una partida contra otro jugador.',
    },
    GAMES_10: {
      name: 'Habitual',
      description: 'Termina 10 partidas contra otros jugadores.',
    },
    GAMES_50: {
      name: 'Veterano',
      description: 'Termina 50 partidas contra otros jugadores.',
    },
    WINS_25: {
      name: 'Conquistador',
      description: 'Gana 25 partidas contra otros jugadores.',
    },
    BOT_EASY: {
      name: 'Calentamiento',
      description: 'Vence al ordenador fácil.',
    },
    BOT_MEDIUM: {
      name: 'Compañero de entrenamiento',
      description: 'Vence al ordenador medio.',
    },
    BOT_HARD: {
      name: 'Azote de máquinas',
      description: 'Vence al ordenador difícil.',
    },
    PUZZLE_FIRST: {
      name: 'Resolutor',
      description: 'Resuelve tu primer problema.',
    },
    PUZZLES_25: {
      name: 'Táctico',
      description: 'Resuelve 25 problemas.',
    },
    STREAK_3: {
      name: 'En racha',
      description: 'Resuelve el problema diario 3 días seguidos.',
    },
    STREAK_7: {
      name: 'Semana táctica',
      description: 'Resuelve el problema diario 7 días seguidos.',
    },
    RATING_1400: {
      name: 'Escalador',
      description: 'Alcanza una puntuación de 1400.',
    },
    LEVEL_5: {
      name: 'Estrella en ascenso',
      description: 'Alcanza el nivel 5.',
    },
  },
};
