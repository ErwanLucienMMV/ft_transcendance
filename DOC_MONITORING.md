# Monitoring : Prometheus, Grafana, alertes et page de statut

Ce document décrit la supervision de la stack : ce qui est mesuré, où le voir, quand une
alerte part et comment la recevoir, et comment faire la démonstration. La procédure de
restauration est dans [`docs/reprise-apres-sinistre.md`](docs/reprise-apres-sinistre.md).

## 1. Vue d'ensemble

```text
                      ┌────────────── réseau Docker « transcendence » ──────────────┐
 navigateur ─ HTTPS ─ nginx ─┬─ /api/v1/health ─ NestJS ─┬─ PostgreSQL, moteur, bot,
                             │                           │  forgemail (health check)
                             │                           └─ /backups/status (lecture seule)
                             └─ /grafana/ ── Grafana ──┬── Prometheus ── scrape ──┬─ nestjs
                                                       │        │                 ├─ node-exporter (machine)
                                                       │        │ règles          ├─ cadvisor (conteneurs)
                                                       │        ▼                 ├─ postgres-exporter
                                                       └── Alertmanager           ├─ alertmanager, grafana
                                                                │                 └─ prometheus
                                                     webhook + jeton
                                                                ▼
                                                           forgemail ── SMTP ── ALERT_EMAIL
```

- **Aucun port publié** en dehors de nginx : Prometheus, Alertmanager, les exporters et
  forgemail ne sont joignables que depuis le réseau Docker. La CI vérifie que seul nginx
  publie des ports.
- **Grafana** est servi sous `/grafana/`, derrière nginx, avec le compte
  `GF_SECURITY_ADMIN_USER` / `GF_SECURITY_ADMIN_PASSWORD` de `srcs/.env` (mot de passe
  aléatoire généré par `make env`).
- **`/api/v1/metrics` est fermé** au public (404 dans nginx) ; Prometheus le lit en interne.
- La page **`/status`** et **`/api/v1/health`** sont publiques : elles disent si le site
  fonctionne, sans rien révéler d'autre.

| Service | Image | Rôle |
| --- | --- | --- |
| `prometheus` | `prom/prometheus:v3.13.3` + `srcs/prometheus/` | Collecte toutes les 15 s (5 s pour l'API), évalue les règles, garde 15 jours |
| `alertmanager` | `prom/alertmanager:v0.34.1` + `srcs/alertmanager/` | Regroupe les alertes et les envoie à forgemail |
| `node-exporter` | `prom/node-exporter:v1.12.1` | Machine : CPU, mémoire, disques (`/` monté en lecture seule) |
| `cadvisor` | `gcr.io/cadvisor/cadvisor:v0.55.1` | Chaque conteneur : CPU, mémoire, réseau, redémarrages |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.20.1` | Statistiques PostgreSQL, avec le rôle en lecture seule |
| `grafana` | `grafana/grafana:13.2.3` + `srcs/grafana/` | Tableaux de bord, règles d'alerte, silences |

## 2. Métriques de l'application

L'API expose sur `/metrics` (et `/v1/metrics`) :

- les métriques Node.js de `prom-client` (CPU, mémoire, event loop, GC) ;
- `http_request_duration_seconds{method, route, status_code}` : durée de chaque réponse
  HTTP, avec la route déclarée (jamais l'URL brute, qui peut contenir un identifiant). Les
  scrapes et le health check n'y sont pas comptés : ce n'est pas du trafic de joueurs ;
- les connexions WebSocket, les parties, le matchmaking et les puzzles (voir
  `srcs/grafana/README.md`) ;
- **`service_up{service}`** : 1 si l'API joint `database`, `chess-engine`, `bot` ou `mail`,
  0 sinon ;
- **`backup_last_success_timestamp_seconds`** : heure de la dernière sauvegarde réussie
  (0 si aucune).

Ces deux dernières viennent du **health check** de l'API (`src/health/`), le même que
`GET /api/v1/health` et la page `/status`. Il est calculé au plus une fois toutes les
10 secondes, quel que soit le nombre de demandeurs (Docker, Prometheus, visiteurs) :

| Vérification | Comment |
| --- | --- |
| `database` | `SELECT 1` |
| `chess-engine`, `bot` | message `{ "op": "ping" }` en WebSocket, réponse attendue avec le même `id` |
| `mail` | `GET http://forgemail:3002/health` |
| sauvegarde | lecture de `backups/status/last-success`, écrit par `backup.sh` après chaque sauvegarde |

Chaque vérification abandonne après 2 secondes. La réponse :

```json
{
  "status": "ok",
  "checkedAt": "2026-11-02T18:40:05.889Z",
  "services": [
    { "name": "database", "status": "up", "latencyMs": 19 },
    { "name": "chess-engine", "status": "up", "latencyMs": 19 },
    { "name": "bot", "status": "up", "latencyMs": 15 },
    { "name": "mail", "status": "up", "latencyMs": 16 }
  ],
  "backup": { "status": "ok", "lastSuccess": "2026-11-02T18:20:03.000Z", "ageSeconds": 1202, "maxAgeSeconds": 7200 }
}
```

`status` vaut `degraded` quand un service autre que la base est injoignable (HTTP 200), et
`down` sans la base (HTTP **503** : le health check Docker de `nestjs` échoue alors). La
sauvegarde est `stale` au-delà de 2 heures et `missing` si aucune n'a été enregistrée ; elle
n'influe pas sur `status`.

## 3. Tableaux de bord

Tous sont provisionnés depuis `srcs/grafana/provisioning/dashboards/` (non modifiables dans
l'interface : on modifie le JSON, puis on reconstruit l'image). Menu **Dashboards >
Transcendence**, ou le menu déroulant « Transcendence dashboards » en haut de chacun.

| Tableau de bord | Contenu |
| --- | --- |
| **Health and alerts** (`/grafana/d/transcendence-overview`) | Services vus par l'API, état de chaque cible Prometheus, âge de la dernière sauvegarde, alertes en cours, requêtes par code HTTP, part d'erreurs 5xx, latence p50 et p95 |
| **Host** (`/d/transcendence-host`) | Uptime, CPU, charge, mémoire, remplissage de chaque disque, débit disque |
| **Containers** (`/d/transcendence-containers`) | Conteneurs en cours, CPU, mémoire et réseau par conteneur, redémarrages |
| **PostgreSQL** (`/d/transcendence-postgres`) | Disponibilité, uptime, connexions (part de `max_connections` et par état), taille, transactions, lignes écrites, taux de cache, plus grosses tables, deadlocks |
| **NestJS**, **WebSocket**, **Matchmaking** | Processus Node.js, connexions temps réel, file d'attente et puzzles (déjà existants) |

Chaque panneau a une description (icône ⓘ) et affiche « No data » plutôt que 0 quand la
métrique manque.

## 4. Alertes

### Règles

Fichier `srcs/prometheus/rules/alerts.yml`, visible dans Grafana sous **Alerting > Alert
rules** (source « Prometheus ») :

| Alerte | Condition | Gravité |
| --- | --- | --- |
| `TargetDown` | une cible ne répond plus à Prometheus pendant 1 min (conteneur arrêté ou en boucle) | critical |
| `ServiceUnreachable` | l'API ne joint plus la base, le moteur, le bot ou forgemail pendant 1 min | critical |
| `PostgresDown` | postgres-exporter ne peut plus se connecter à la base pendant 1 min | critical |
| `ApiHighErrorRate` | plus de 5 % de réponses 5xx sur 5 min (avec au moins 0,1 requête/s), pendant 5 min | warning |
| `ApiSlowResponses` | p95 des réponses au-dessus d'1 s pendant 10 min | warning |
| `PostgresTooManyConnections` | plus de 80 % de `max_connections` pendant 5 min | warning |
| `BackupStale` | dernière sauvegarde de plus de 2 heures | warning |
| `BackupMissing` | aucune sauvegarde enregistrée depuis 2 heures (service de sauvegarde non lancé) | warning |
| `DiskAlmostFull` | moins de 10 % libre sur un disque pendant 5 min (une alerte par disque) | warning |
| `HostLowMemory` | moins de 10 % de mémoire disponible pendant 10 min | warning |
| `ContainerRestarting` | un conteneur a démarré plus de 2 fois en 15 min | warning |

Les règles sont **testées** : `srcs/prometheus/tests/alerts.test.yml` simule des séries
(cible arrêtée, erreurs, latence, sauvegarde ancienne ou absente, disque plein monté deux
fois, redémarrages…) et vérifie quelles alertes partent, avec leurs textes exacts.

### Acheminement

Prometheus envoie les alertes à **Alertmanager**, qui les regroupe (par règle et par job,
30 s d'attente pour grouper celles qui arrivent ensemble), puis appelle le webhook
`POST http://forgemail:3002/v1/alerts` avec le jeton `ALERT_WEBHOOK_TOKEN`. **forgemail**
en fait un email (sujet `[42 Chess] Alert: TargetDown`, une section par alerte, liens vers
Grafana et la page de statut) envoyé à `ALERT_EMAIL`, avec les réglages SMTP des emails de
compte. Une alerte qui dure est renvoyée toutes les 4 heures ; sa fin est annoncée
(`[42 Chess] Resolved: …`).

L'API n'est pas sur ce chemin : une panne de l'API est donc bien signalée. Si forgemail est
lui-même arrêté, les alertes restent visibles dans Grafana (**Alerting > Alert groups**) et
Alertmanager réessaie l'envoi.

Quand PostgreSQL tombe, `PostgresDown` suffit : Alertmanager retient `ServiceUnreachable`
(service `database`) et `TargetDown` de l'API, qui n'en sont que la conséquence.

Réglages dans `srcs/.env` :

```dotenv
# Adresses séparées par des virgules ; vide = alertes seulement dans Grafana et `docker logs forgemail`
ALERT_EMAIL=admin@example.org, autre@example.org
# Généré par `make env`, partagé par Alertmanager et forgemail
ALERT_WEBHOOK_TOKEN=…
```

Sans `SMTP_USER` / `SMTP_PASSWORD`, forgemail écrit l'email dans ses logs au lieu de
l'envoyer, comme pour les emails de compte : `docker logs forgemail` le montre en entier.

### Silences

Pendant une maintenance (restauration, démonstration), **Alerting > Silences > New silence**
dans Grafana (source « Alertmanager ») coupe les emails d'une alerte pour une durée donnée.

## 5. Démonstration

1. `make` (ou `make full` pour avoir aussi les sauvegardes), puis ouvrir
   `https://<hôte>:<APPPORT>/grafana/` et se connecter.
2. Tableau de bord **Health and alerts** : tout est UP, la dernière sauvegarde a moins d'une
   heure (avec `make full`).
3. Arrêter un conteneur, par exemple l'exporter PostgreSQL :

   ```bash
   docker stop postgres-exporter
   ```

4. Après environ 1 minute, `TargetDown` passe de *Pending* à *Firing* dans **Alerting > Alert
   rules** ; 30 secondes plus tard l'email part (ou apparaît dans `docker logs forgemail`) :

   ```text
   Subject: [42 Chess] Alert: TargetDown

   Monitoring alerts on 42 Chess: 1 firing.

   FIRING · critical · TargetDown
   postgres is not answering Prometheus
   Prometheus could not read the metrics of postgres-exporter:9187 (job postgres) for at least
   one minute. The container is probably stopped or crashing: check `docker compose ps` and its logs.
   Since: 2026-11-02 18:45:42 UTC
   ```

5. `docker start postgres-exporter` : l'alerte se résout et l'email « Resolved » suit dans
   les 5 minutes.
6. Pour la page de statut, arrêter le bot (`docker compose -f srcs/docker-compose.yml stop bot`) :
   `/status` passe à « Some services are down » avec « Computer opponent : Down » à
   l'actualisation suivante (30 s), puis `ServiceUnreachable` part au bout d'une minute.
   `docker compose -f srcs/docker-compose.yml start bot` pour revenir.

## 6. Vérifier la configuration

```bash
make check-monitoring
```

Lance, dans les images officielles, `promtool check config`, `promtool test rules` (les
tests des règles), `amtool check-config`, puis `srcs/grafana/scripts/validate_dashboards.py`.
La CI l'exécute à chaque push. Au démarrage, le conteneur Prometheus refuse aussi de
démarrer avec une configuration invalide (message dans `docker logs prometheus`).

## 7. Dépannage

| Symptôme | Cause et solution |
| --- | --- |
| Le tableau de bord **Containers** est vide | cAdvisor ne trouve pas containerd. `docker logs cadvisor` affiche « Registration of the docker container factory failed ». Si Docker n'est pas lancé par systemd, son containerd écoute ailleurs : ajouter `--containerd=/var/run/docker/containerd/containerd.sock` aux options de `cadvisor` |
| `postgres` DOWN dans les cibles, `PostgresDown` | Le rôle en lecture seule est recréé à chaque démarrage de `postgres` à partir de `POSTGRES_BACKUP_USER` / `POSTGRES_BACKUP_PASSWORD` : vérifier ces valeurs dans `srcs/.env`, puis `docker compose -f srcs/docker-compose.yml restart postgres postgres-exporter` |
| `BackupMissing` | Le service de sauvegarde ne tourne pas : `make backup`, ou `make full` |
| Aucun email d'alerte | `ALERT_EMAIL` vide ou SMTP non configuré : voir `docker logs forgemail` (ligne `monitoring alerts:` au démarrage) |
| `alertmanager` redémarre en boucle | `ALERT_WEBHOOK_TOKEN` manquant : `make env` le génère |
| Docker Desktop (macOS) | node-exporter et cAdvisor y mesurent la machine virtuelle de Docker, pas le Mac |
