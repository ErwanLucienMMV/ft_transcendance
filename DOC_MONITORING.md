# Monitoring — Grafana

## 1. Accéder à Grafana

En développement / pendant la phase actuelle où Grafana est exposé sur l'hôte :

```text
http://localhost:3001
```

Page de connexion :

```text
http://localhost:3001/login
```

Identifiants initiaux :

```text
Username: admin
Password: admin
```

Grafana peut demander de modifier le mot de passe lors de la première connexion.

> En production finale, Grafana sera accessible uniquement via Nginx et ne sera plus directement exposé sur un port de l'hôte.

---

## 2. Vérifier que Grafana fonctionne

### Vérifier le conteneur

```bash
docker ps
```

Le conteneur `grafana` doit être `Up`.

### Vérifier l'API Grafana

```bash
curl http://localhost:3001/api/health
```

Réponse attendue :

```json
{
  "database": "ok",
  "version": "13.2.3",
  "commit": "..."
}
```

### Voir les logs

```bash
docker logs grafana
```

---

# 3. Pages principales

## Dashboards

```text
Dashboards → Transcendence → Transcendence - NestJS
```

Dashboard principal du projet.

Il affiche notamment :

* **NestJS Target** — vérifie que Prometheus récupère correctement les métriques NestJS.
* **CPU Usage** — utilisation CPU de NestJS.
* **Resident Memory** — mémoire RAM utilisée par NestJS.
* **Node.js Heap Usage** — utilisation du heap Node.js.
* **Event Loop Lag** — latence de l'event loop Node.js.
* **Active Resources** — ressources Node.js actuellement actives.
* **Active Requests** — requêtes Node.js actuellement actives.
* **GC Duration** — temps passé par le Garbage Collector.
* **Prometheus Target Status** — historique de disponibilité de la target NestJS.

Le dashboard est **provisionné automatiquement** depuis :

```text
srcs/grafana/provisioning/dashboards/transcendence.json
```

Il ne doit donc pas être recréé manuellement après un déploiement.

---

## Connections → Data sources

Cette page permet de voir les sources de données utilisées par Grafana.

La datasource actuelle est :

```text
Prometheus
```

Configuration :

```text
URL: http://prometheus:9090
```

Elle est automatiquement provisionnée depuis :

```text
srcs/grafana/provisioning/datasources/prometheus.yml
```

Elle est configurée comme datasource par défaut et n'est pas modifiable depuis l'interface.

---

## Explore

La page **Explore** permet d'interroger directement Prometheus avec du **PromQL**.

Exemple :

```promql
up{job="nestjs"}
```

Permet de vérifier que NestJS est actuellement disponible pour Prometheus.

Autre exemple :

```promql
process_resident_memory_bytes{job="nestjs"}
```

Permet d'afficher la mémoire utilisée par NestJS.

Cette page est principalement utile pour tester des métriques et créer de futurs panels.

---

# 4. Ajouter des métriques

Les métriques Node.js sont déjà fournies par `prom-client`.

L'API peut également ajouter des métriques métier, par exemple :

```text
chess_games_started_total
chess_games_finished_total
chess_active_games
auth_logins_total
matchmaking_requests_total
```

Types recommandés :

| Type        | Utilisation        |
| ----------- | ------------------ |
| `Counter`   | Événements cumulés |
| `Gauge`     | Valeur actuelle    |
| `Histogram` | Durées / latences  |

Ces métriques seront automatiquement disponibles dans Grafana une fois exposées par NestJS.

---

# 5. Provisioning

Structure :

```text
srcs/grafana/
├── Dockerfile
└── provisioning/
    ├── dashboards/
    │   ├── dashboard.yml
    │   └── transcendence.json
    └── datasources/
        └── prometheus.yml
```

Le dashboard et la datasource sont donc versionnés avec le projet.

Après modification du provisioning :

```bash
docker compose -f srcs/docker-compose.yml build grafana
docker compose -f srcs/docker-compose.yml up -d --force-recreate grafana
```

---

# 6. État actuel

* [x] Grafana installé
* [x] Version fixée à `13.2.3`
* [x] Volume persistant configuré
* [x] Datasource Prometheus provisionnée
* [x] Dashboard NestJS provisionné
* [x] Métriques Node.js visibles

### Bonus(Todo si le temps est la)
* [ ] Ajouter les métriques métier
* [ ] Dashboard PostgreSQL
* [ ] Alerting
* [ ] Mettre Grafana derrière Nginx
* [ ] Supprimer l'exposition directe de Grafana en production
