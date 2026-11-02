import type { Translation } from '../../core/i18n/i18n';

export const home: Translation['home'] = {
  eyebrow: 'Jouer aux échecs',
  titleStart: 'Chaque coup',
  titleMiddle: 'raconte',
  titleAccent: 'une histoire.',
  description:
    'Des parties classées contre des joueurs de votre niveau, un ordinateur à trois niveaux, un nouveau puzzle chaque jour et des parties en direct à regarder.',
  play: 'Jouer une partie',
  todayPuzzle: 'Le puzzle du jour',
  createAccount: 'Créer un compte',
  signIn: 'Se connecter',
  signedInAs: 'Connecté en tant que',
  elo: 'Elo',
  guest: "Gratuit, sans publicité. L'échiquier d'analyse fonctionne sans compte.",
  openingPosition: 'Position de départ',
  whiteToMove: 'Les Blancs jouent',
  featuresTitle: 'Ce que vous pouvez faire',
  features: {
    online: {
      title: 'Jouer en ligne',
      text: 'Des parties classées contre un joueur de même Elo, ou un lien pour un ami.',
    },
    computer: {
      title: "Jouer contre l'ordinateur",
      text: "Trois niveaux, de celui qui voit un coup d'avance à celui qui trouve les mats courts.",
    },
    puzzle: {
      title: 'Puzzle du jour',
      text: 'Une position par jour. Trouvez le meilleur coup et battez votre temps.',
    },
    live: {
      title: 'Regarder en direct',
      text: 'Suivez les parties en cours, coup par coup.',
    },
  },
  notFound: {
    title: 'Page introuvable',
    text: "La page demandée n'existe pas. Un nouveau coup est toujours possible.",
    back: "Revenir à l'accueil",
  },
  frame: {
    quoteStart: 'Chaque coup raconte',
    quoteAccent: 'une histoire.',
    rated: 'Des parties classées contre des joueurs de votre niveau',
    computer: 'Un ordinateur à trois niveaux',
    puzzle: 'Un nouveau puzzle chaque jour',
  },
};
