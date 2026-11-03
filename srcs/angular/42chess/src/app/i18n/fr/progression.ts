import type { Translation } from '../../core/i18n/i18n';

export const progression: Translation['progression'] = {
  leaderboard: {
    eyebrow: 'Joueurs',
    title: 'Classement',
    intro:
      'Tous les joueurs ayant une partie classée, du meilleur Elo au plus bas. Les égalités partagent un rang.',
    howLink: "Comment fonctionnent l'Elo, l'XP et les niveaux",
    yourRank: 'Votre rang',
    showMine: 'Voir mon rang',
    failed: "Le classement n'a pas pu être chargé.",
    none: 'Aucun joueur classé pour le moment.',
    noneHelp: 'Terminez une partie classée pour apparaître ici.',
    play: 'Jouer une partie classée',
    caption: 'Classement, page {{page}} sur {{pages}}',
    rank: 'Rang',
    player: 'Joueur',
    rating: 'Elo',
    record: 'Gagnées · Nulles · Perdues',
    level: 'Niveau',
    you: 'vous',
    loading: 'Chargement du classement…',
  },
  stats: {
    rating: 'Elo',
    rank: 'Rang',
    of: ' sur {{total}}',
    unranked: 'Non classé',
    level: 'Niveau',
    streak: 'Série de puzzles',
    days: {
      one: 'jour, record {{best}}',
      other: 'jours, record {{best}}',
    },
    failed: "Certaines statistiques n'ont pas pu être chargées.",
    results: 'Résultats',
    games: 'Parties',
    played: 'Jouées',
    won: 'Gagnées',
    drawn: 'Nulles',
    lost: 'Perdues',
    rated: 'Classées',
    casual: 'Amicales',
    computer: 'Ordinateur',
    ratedOnly: "Seules les parties classées changent l'Elo.",
    puzzles: {
      one: '{{count}} puzzle résolu du premier coup.',
      other: '{{count}} puzzles résolus du premier coup.',
    },
    progression: 'Progression',
    earn: "Les parties, les puzzles et les succès rapportent de l'XP.",
    how: 'Comment fonctionne la progression',
    achievements: 'Succès',
    unlockedCount: '{{count}} sur {{total}} débloqués',
    unlocked: 'Débloqué le {{date}}',
    progress: 'Progression : {{name}}',
  },
  rules: {
    eyebrow: 'Progression',
    title: 'Comment fonctionne la progression',
    intro:
      "Votre Elo mesure votre force face aux autres joueurs. L'expérience (XP) récompense tout ce que vous jouez : elle fait monter votre niveau et ne baisse jamais.",
    ratingTitle: 'Elo et classement',
    start:
      "Chaque compte commence à 1200. Seules les parties classées contre d'autres joueurs le modifient.",
    elo: 'Battre un joueur plus fort rapporte plus que battre un joueur plus faible (Elo, K = 32).',
    boardStart: 'Le',
    boardLink: 'classement',
    boardEnd:
      'liste tous les joueurs ayant au moins une partie classée, du meilleur Elo au plus bas. Les égalités partagent un rang.',
    xpFailed: "Le barème d'XP n'a pas pu être chargé. Réessayez plus tard.",
    xpTitle: 'Expérience',
    xpCaption: 'XP gagnée',
    you: 'Vous…',
    game: 'Gagner, annuler ou perdre une partie contre un joueur',
    botEasy: "Gagner ou annuler contre l'ordinateur facile",
    botMedium: "Gagner ou annuler contre l'ordinateur moyen",
    botHard: "Gagner ou annuler contre l'ordinateur difficile",
    daily: 'Résoudre le puzzle du jour le jour même',
    archive: 'Résoudre un puzzle des archives',
    streak: 'Bonus de série, par jour de série',
    streakValue: "+{{bonus}}, jusqu'à +{{cap}}",
    achievement: 'Débloquer un succès',
    asListed: 'voir la liste ci-dessous',
    gameCounts:
      "Une partie compte dès que chaque camp a joué {{moves}} coups. Une défaite contre l'ordinateur ne rapporte rien.",
    firstAttempt:
      "Un puzzle rapporte de l'XP à votre premier et unique essai. Le recommencer en fait un entraînement, qui ne rapporte rien.",
    mistakes:
      "{{max}} mauvais coups mettent fin à un essai. Un indice divise l'XP du puzzle par deux (par exemple {{full}} devient {{half}}) ; afficher la solution termine l'essai sans XP.",
    streakTitle: 'Série de puzzles du jour',
    streakText:
      "Résolvez le puzzle du jour le jour même, du premier essai, pour ajouter un jour à votre série. Manquez un jour ou ratez l'essai, et le prochain puzzle du jour résolu commence une nouvelle série. Les jours changent à minuit UTC.",
    levelsTitle: 'Niveaux',
    levelsText: "Chaque niveau demande un peu plus d'XP que le précédent.",
    level: 'Niveau {{level}}',
    achievementsTitle: 'Succès',
    badgeOnly: 'Badge seulement',
    loading: 'Chargement des règles…',
  },
  achievements: {
    FIRST_GAME: {
      name: "Coup d'ouverture",
      description: 'Terminez votre première partie contre un autre joueur.',
    },
    FIRST_WIN: {
      name: 'Première victoire',
      description: 'Gagnez une partie contre un autre joueur.',
    },
    GAMES_10: {
      name: 'Habitué',
      description: "Terminez 10 parties contre d'autres joueurs.",
    },
    GAMES_50: {
      name: 'Vétéran',
      description: "Terminez 50 parties contre d'autres joueurs.",
    },
    WINS_25: {
      name: 'Conquérant',
      description: "Gagnez 25 parties contre d'autres joueurs.",
    },
    BOT_EASY: {
      name: 'Échauffement',
      description: "Battez l'ordinateur facile.",
    },
    BOT_MEDIUM: {
      name: "Partenaire d'entraînement",
      description: "Battez l'ordinateur moyen.",
    },
    BOT_HARD: {
      name: 'Tombeur de machines',
      description: "Battez l'ordinateur difficile.",
    },
    PUZZLE_FIRST: {
      name: 'Résolveur',
      description: 'Résolvez votre premier puzzle.',
    },
    PUZZLES_25: {
      name: 'Tacticien',
      description: 'Résolvez 25 puzzles.',
    },
    STREAK_3: {
      name: 'Sur une lancée',
      description: 'Résolvez le puzzle du jour 3 jours de suite.',
    },
    STREAK_7: {
      name: 'Semaine tactique',
      description: 'Résolvez le puzzle du jour 7 jours de suite.',
    },
    RATING_1400: {
      name: 'Grimpeur',
      description: 'Atteignez un Elo de 1400.',
    },
    LEVEL_5: {
      name: 'Étoile montante',
      description: 'Atteignez le niveau 5.',
    },
  },
};
