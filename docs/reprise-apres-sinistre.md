# Reprise après sinistre

Procédures pour remettre 42 Chess en service après une perte de données, du cas le plus
fréquent (une mauvaise manipulation) au plus grave (la machine perdue). Le fonctionnement des
sauvegardes est décrit dans [BACKUP.md](../BACKUP.md), la supervision dans
[DOC_MONITORING.md](../DOC_MONITORING.md).

## Objectifs

| | Valeur | D'où elle vient |
| --- | --- | --- |
| **Perte de données maximale (RPO)** | 1 heure | une sauvegarde par heure (`backup/tools/crontab`) |
| **Durée de restauration (RTO)** | quelques minutes une fois la stack démarrée | la restauration elle-même prend moins d'une minute à la taille actuelle de la base ; reconstruire les images (`make`) prend plus longtemps |
| **Rétention** | 24 heures | `backup.sh` supprime les sauvegardes plus anciennes |
| **Détection** | moins de 2 h 05 si les sauvegardes s'arrêtent | alertes `BackupStale` et `BackupMissing`, page `/status` |

## Ce qui est sauvegardé, et ce qui ne l'est pas

| Donnée | Sauvegardée ? | En cas de perte |
| --- | --- | --- |
| Base PostgreSQL (comptes, parties, puzzles, messages, progression) | oui, toutes les heures, dans `backups/` | restauration ci-dessous |
| Avatars envoyés (volume `avatars`) | non | les profils affichent l'initiale du joueur à la place ; chacun peut renvoyer son image. Copie manuelle possible, voir plus bas |
| `srcs/.env` (secrets) | non, à garder hors de la machine | `make env` en génère un nouveau ; les joueurs doivent alors se reconnecter (nouveau `JWT_SECRET`), et il faut reporter les identifiants SMTP et OAuth |
| Historique Prometheus, base de Grafana | non | perte de l'historique des graphiques seulement ; tableaux de bord et sources sont reprovisionnés au démarrage |

Copie manuelle des avatars, à lancer depuis la racine du dépôt :

```bash
docker run --rm -v srcs_avatars:/avatars:ro -v "$PWD/backups:/out" \
    docker.io/library/debian:bookworm tar -czf /out/avatars.tar.gz -C /avatars .
```

## Avant toute restauration

1. **Identifier la sauvegarde à restaurer.** `make backups` les liste, la plus récente en
   premier. Le nom donne l'heure UTC : `transcendence_2026-11-02_16-00-00.sql.gz`. Après une
   mauvaise manipulation, choisir la dernière sauvegarde **antérieure** à l'erreur.
2. **Mettre les alertes en silence** si la restauration va durer : Grafana, **Alerting >
   Silences > New silence**, matcher `severity =~ critical|warning`, durée 30 minutes.
3. **Prévenir** que tout ce qui a été fait après l'heure de la sauvegarde sera perdu.

## Scénario 1 : données erronées, base intacte

Une suppression ou une modification massive par erreur, une migration qui a mal tourné.

```bash
make backups
make restore BACKUP=transcendence_2026-11-02_16-00-00.sql.gz
```

`make restore` arrête tous les services sauf PostgreSQL (rien n'écrit pendant la
restauration), demande confirmation, restaure dans **une seule transaction**, puis
redémarre tout, que la restauration ait réussi ou non. En cas d'erreur (fichier abîmé,
droit manquant), la transaction est annulée : la base reste exactement dans l'état d'avant
et la commande se termine en erreur.

Puis passer aux [vérifications](#après-la-restauration).

## Scénario 2 : base perdue, machine intacte

Le volume `postgres_data` est détruit (`make fclean`, disque de données défaillant, volume
supprimé par erreur). Le dossier `backups/` est sur l'hôte, hors de tout volume : il est
intact.

```bash
make                 # recrée une base vide ; l'API applique les migrations
make backup          # relance le service de sauvegarde (backups/ est conservé)
make backups         # choisir la plus récente
make restore BACKUP=<fichier>
```

Pas besoin de restaurer avant la prochaine heure pleine : la première sauvegarde automatique
n'a lieu qu'à l'heure suivante. Restaurer **avant** cette heure, sinon la plus récente sera
la sauvegarde de la base vide (elle reste listée, il suffit de prendre la précédente).

Le rôle en lecture seule des sauvegardes et du monitoring est recréé par le conteneur
`postgres` à son démarrage : rien à faire à la main.

## Scénario 3 : machine perdue

La machine et son disque sont perdus. Seule une **copie de `backups/` faite ailleurs**
permet de récupérer les données ; la copier régulièrement fait partie de l'exploitation
(par exemple `rsync -a backups/ autre-machine:42chess-backups/` toutes les heures).

1. Sur la nouvelle machine : cloner le dépôt, remettre le `srcs/.env` conservé (ou
   `make env` puis reporter SMTP, OAuth et `ALERT_EMAIL`).
2. Recopier les sauvegardes dans `backups/` à la racine du dépôt.
3. Suivre le [scénario 2](#scénario-2--base-perdue-machine-intacte).
4. Si une copie des avatars existe :

   ```bash
   docker run --rm -v srcs_avatars:/avatars -v "$PWD/backups:/in:ro" \
       docker.io/library/debian:bookworm tar -xzf /in/avatars.tar.gz -C /avatars
   ```

5. Si l'adresse du site change, mettre à jour `APPURL` et les URL de rappel OAuth.

## Après la restauration

1. **Page `/status`** : « All systems operational », chaque service *Operational*.
2. **`curl -k https://<hôte>:<APPPORT>/api/v1/health`** : `"status": "ok"`.
3. **Contenu** : se connecter avec un compte connu, ouvrir son profil et l'historique des
   parties ; le classement (`/leaderboard`) doit correspondre à l'heure de la sauvegarde.
4. **Grafana**, tableau de bord **Health and alerts** : toutes les cibles UP, aucune alerte en
   cours. Lever le silence posé avant la restauration.
5. **Sauvegardes** : `make backup-now` puis `make backups` ; la page `/status` doit afficher
   « Last backup less than a minute ago » dans les 10 secondes.

## Test de la procédure

Testé le 2 novembre 2026 avec les scripts du dépôt (`backup/tools/backup.sh` et
`restore.sh`, seuls les chemins `/backups` et `/etc/transcendence-*.env` adaptés), sur
PostgreSQL 16, contre une base de développement de 23 tables (205 comptes, 65 parties,
128 puzzles, 34 migrations) :

| Étape | Résultat |
| --- | --- |
| Sauvegarde avec le rôle en lecture seule (`pg_read_all_data`, `pg_monitor`) | fichier de 116 Ko, droits `600` ; `backups/status/last-success` en `644` |
| Base **effacée** (`DROP DATABASE`), recréée vide, migrations appliquées par l'API | l'API démarre sur la base vide, 0 compte |
| `restore.sh <dernière sauvegarde> --yes` | code 0, « PostgreSQL restoration completed successfully » |
| Comparaison table par table avec la base d'origine | les 23 tables ont exactement le même nombre de lignes |
| API démarrée sur la base restaurée | aucune erreur ; `GET /v1/leaderboard` identique octet pour octet à celui de la base d'origine |
| Restauration d'un fichier tronqué | refusée par `gzip -t`, code 1, base inchangée |
| Restauration d'un fichier dont une instruction échoue | `ERROR` puis annulation de la transaction, code 3, base inchangée |

Le rôle en lecture seule a été testé au démarrage de PostgreSQL : création sur une base
neuve, recréation avec ses droits après suppression, nouveau mot de passe pris en compte,
et démarrage normal (avec un avertissement) quand ses variables sont vides.

À refaire après tout changement de `backup/`, de `srcs/postgreSQL/` ou de la version de
PostgreSQL.
