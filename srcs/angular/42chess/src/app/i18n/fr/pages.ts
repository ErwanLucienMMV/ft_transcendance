import type { Translation } from '../../core/i18n/i18n';

export const legal: Translation['legal'] = {
  updated: 'Dernière mise à jour :',
};

export const design: Translation['design'] = {
  title: 'Le style de 42 Chess',
  intro:
    'Chaque couleur, style de texte et composant réutilisable du site, dessiné par le vrai code. Changez de thème pour vérifier les deux.',
  onThisPage: 'Sur cette page',
  sections: {
    colours: 'Couleurs',
    type: 'Typographie',
    icons: 'Icônes',
    actions: 'Boutons et champs',
    feedback: 'Retours',
    navigation: 'Choix et pages',
    chess: 'Échecs',
    players: 'Joueurs',
  },
  coloursNote:
    "Jetons sur <code>:root</code> dans <code>styles.css</code> ; le thème clair les redéfinit sous <code>[data-theme='light']</code>. Les composants n'utilisent que des jetons.",
  groups: {
    Surfaces: 'Surfaces',
    Text: 'Texte',
    Accent: 'Accent',
    Feedback: 'Retours',
  },
  typeSamples: {
    eyebrow: 'Surtitre · nom de section',
    h1: 'Titre de page (h1), 28 px display',
    h2: 'Titre de section (h2), 17 px display',
    h3: 'Titre de sous-section (h3)',
    body: 'Texte courant, 15 px. Une partie se termine par mat, abandon, temps ou accord.',
    muted: 'Le texte atténué explique ou précise.',
    small: 'Petit texte pour les dates et les nombres.',
    mono: 'chasse fixe pour les coups, les codes et les jetons.',
  },
  iconsNote:
    '<code>&lt;app-icon name="…" /&gt;</code> : traits de 24 px dans la couleur du texte, cachés aux lecteurs d\'écran ; un bouton garde donc ses mots ou un <code>aria-label</code>.',
  buttons: {
    primary: 'Principal',
    secondary: 'Secondaire',
    ghost: 'Discret',
    danger: 'Danger',
    small: 'Petit',
    disabled: 'Désactivé',
    link: 'Un lien en bouton',
  },
  switch: 'Un interrupteur : un réglage activé ou non',
  checkbox: 'Une case à cocher : un accord dans un formulaire',
  alerts: 'Alertes',
  tones: {
    error: {
      heading: 'Erreur',
      text: "Un message d'erreur sur cette page.",
      name: 'erreur',
      toast: "Votre coup n'a pas été envoyé. Réessayez.",
    },
    warning: {
      heading: 'Avertissement',
      text: "Un message d'avertissement sur cette page.",
      name: 'avertissement',
      toast: 'Votre connexion est instable.',
    },
    success: {
      heading: 'Succès',
      text: 'Un message de réussite sur cette page.',
      name: 'succès',
      toast: 'Paramètres enregistrés.',
    },
    info: {
      heading: 'Information',
      text: "Un message d'information sur cette page.",
      name: 'information',
      toast: '{{name}} est maintenant en ligne.',
    },
  },
  toasts: 'Notifications',
  toastsNote:
    "Les nouvelles d'ailleurs, en haut à droite. Les erreurs disparaissent quand le joueur change de page.",
  show: 'Afficher {{tone}}',
  empty: 'Vide et chargement',
  badges: 'Badges',
  badgeTones: {
    neutral: 'neutre',
    accent: 'accent',
    success: 'succès',
    warning: 'avertissement',
    danger: 'danger',
  },
  dialog: 'Boîte de dialogue',
  removeFriend: 'Retirer un ami…',
  answer: 'Réponse : {{text}}',
  answers: {
    removed: 'retiré',
    kept: 'gardé',
  },
  shortRemoveText: "L'un ou l'autre pourra envoyer une nouvelle demande plus tard.",
  speed: 'Rythme',
  examplePages: "Pages d'exemple",
  boardHelp:
    'Glissez ou cliquez pour jouer, flèches du clavier pour parcourir les cases, clic droit pour tracer des flèches.',
};
