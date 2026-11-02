import type { Translation } from '../../core/i18n/i18n';

export const status: Translation['status'] = {
  eyebrow: 'État du service',
  title: '42 Chess fonctionne-t-il ?',
  intro:
    "Ce que le serveur atteint en ce moment. Cette page se met à jour toutes les {{seconds}} secondes tant qu'elle est ouverte.",
  checking: 'Vérification des services…',
  services: 'Services',
  unknown: 'Inconnu',
  operational: 'Opérationnel',
  down: 'En panne',
  backups: 'Sauvegardes de la base',
  backupNote: 'Une sauvegarde a lieu chaque heure et les 24 dernières heures sont conservées.',
  checkedAt: 'Vérifié à {{time}}',
  checkingShort: 'Vérification…',
  again: 'Vérifier à nouveau',
  list: {
    api: {
      name: 'Site et API',
      role: 'Pages, connexion et parties en direct',
    },
    database: {
      name: 'Base de données',
      role: 'Comptes, parties, puzzles et messages',
    },
    'chess-engine': {
      name: 'Moteur de règles',
      role: 'Vérifie chaque coup de chaque partie',
    },
    bot: {
      name: 'Ordinateur adversaire',
      role: "Parties contre l'ordinateur",
    },
    mail: {
      name: 'Email',
      role: 'Emails de vérification et de mot de passe',
    },
  },
  unreachable: {
    title: '42 Chess est injoignable',
    text: 'Le serveur ne répond pas : parties, connexion et puzzles sont indisponibles.',
  },
  outage: {
    title: 'Panne majeure',
    text: 'La base de données est injoignable : rien de ce qui demande un compte ne fonctionne.',
  },
  degraded: {
    title: 'Certains services sont en panne',
    text: 'Le site fonctionne, sauf ce qui dépend des services signalés ci-dessous.',
  },
  ok: {
    title: 'Tout fonctionne',
    text: 'Tout fonctionne normalement.',
  },
  noBackup: "Aucune sauvegarde n'a encore été enregistrée.",
  lastBackup: 'Dernière sauvegarde {{ago}}.',
  lateBackup: 'En retard : la dernière sauvegarde date de {{ago}}.',
  ago: {
    now: "il y a moins d'une minute",
    day: {
      one: 'il y a {{count}} jour',
      other: 'il y a {{count}} jours',
    },
    hour: {
      one: 'il y a {{count}} heure',
      other: 'il y a {{count}} heures',
    },
    minute: {
      one: 'il y a {{count}} minute',
      other: 'il y a {{count}} minutes',
    },
  },
};
