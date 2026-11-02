COMPOSE_DIR	= srcs
COMPOSE_FILE	= docker-compose.yml
DEV_COMPOSE	= docker-compose.dev.yml
TEST_COMPOSE	= $(COMPOSE_DIR)/nestJS/42chess/test/docker-compose.yml

all: env
	@mkdir -p backups/status
	@echo "Starting the building of images, be patient this can take a loooong time"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build -d > compose.log 2>&1 || { \
		echo "Build or start failed, last lines of compose.log:"; \
		tail -n 40 compose.log; \
		echo "Last NestJS logs (an unhealthy nestjs blocks nginx):"; \
		docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) logs --tail 20 nestjs 2>/dev/null; \
		exit 1; }
	@echo "Images have been built, now comes running them"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) logs >> compose.log 2>&1
	@$(MAKE) --no-print-directory puzzles
	@echo "All set, feel free to test it"

# Imports the bundled puzzle catalogue (checked by the chess engine). Puzzles
# already present are skipped, so it is safe after every start.
puzzles:
	@echo "Importing the puzzle catalogue"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) exec -T nestjs node dist/puzzles/run-puzzle-import.js

loud: env
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build

dev: env
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) up --build

# Creates srcs/.env with random secrets, or fills the ones it lacks, then
# warns about settings that would break sign-in, emails or links.
env:
	@sh $(COMPOSE_DIR)/init-env.sh
	@sh $(COMPOSE_DIR)/check-env.sh

down:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down
	docker compose -f ./backup/docker-compose.yml down

# rules for the backup, use AFTER the main stack is started
backup:
	@echo "Starting the backup"
	@docker compose -f backup/docker-compose.yml up -d --build
	@echo "The backup container is online, please see the crontab file for the period between two backup"

backup-down:
	@echo "Backup container will be down, if you crash the prod rn just know that anything that happened after that cannot be saved, it's between you and god now"
	@docker compose -f backup/docker-compose.yml down
	@echo "Backup container is now successfully down, may the force be with you"

backup-logs:
	@docker compose -f backup/docker-compose.yml logs -f

# Takes a backup right now, outside the hourly schedule.
backup-now:
	@docker exec transcendence-backup /usr/local/bin/backup.sh

# Lists the backups, newest first.
backups:
	@{ docker exec transcendence-backup ls -1t /backups 2>/dev/null || ls -1t "$${BACKUP_DIR:-backups}" 2>/dev/null; } \
		| grep '^transcendence_.*\.sql\.gz$$' || echo "No backup yet (run make full or make backup)"

# Restores one backup: make restore BACKUP=transcendence_<date>.sql.gz
# The application is stopped meanwhile; the restore is all or nothing.
restore:
	@[ -n "$(BACKUP)" ] || { echo "Usage: make restore BACKUP=<file> (see make backups)"; exit 1; }
	@$(MAKE) --no-print-directory stop-app
	@docker exec $$([ -t 0 ] && echo -it || echo -i) transcendence-backup /usr/local/bin/restore.sh "$(BACKUP)" $(if $(YES),--yes); \
	status=$$?; \
	$(MAKE) --no-print-directory start-app; \
	exit $$status

full: all
	@echo "Main stack is ready, starting the independent backup service"
	@$(MAKE) --no-print-directory backup

# Every service but PostgreSQL, so that nothing writes during a restore.
APP_SERVICES	= chess-engine bot forgemail nestjs nginx prometheus alertmanager \
		  grafana node-exporter cadvisor postgres-exporter

stop-app:
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) stop $(APP_SERVICES)

start-app:
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) start $(APP_SERVICES)

# Offline checks of the monitoring configuration (Docker only): Prometheus
# configuration and alert rules with their unit tests, Alertmanager
# configuration, Grafana dashboards.
PROMETHEUS_IMAGE	= docker.io/prom/prometheus:v3.13.3
ALERTMANAGER_IMAGE	= docker.io/prom/alertmanager:v0.34.1
check-monitoring:
	@docker run --rm --entrypoint /bin/sh \
		-v "$(CURDIR)/$(COMPOSE_DIR)/prometheus:/src:ro" \
		-v "$(CURDIR)/$(COMPOSE_DIR)/prometheus/rules:/etc/prometheus/rules:ro" \
		$(PROMETHEUS_IMAGE) -c 'sed "s/\$${APIPORT}/3000/g" /src/prometheus.yml > /tmp/prometheus.yml \
			&& promtool check config /tmp/prometheus.yml && cd /src && promtool test rules tests/alerts.test.yml'
	@docker run --rm --entrypoint /bin/sh \
		-v "$(CURDIR)/$(COMPOSE_DIR)/alertmanager:/src:ro" \
		$(ALERTMANAGER_IMAGE) -c 'printf x > /tmp/alert-webhook-token && amtool check-config /src/alertmanager.yml'
	@python3 $(COMPOSE_DIR)/grafana/scripts/validate_dashboards.py

# The tests do not read srcs/.env: they bring their own settings.
# --profile is required by podman-compose to see the `tests` service; the
# container itself is removed by --rm, so `down` does not need it.
test: test-bot
	@docker compose -f $(TEST_COMPOSE) --profile tests run --rm --build tests; \
	status=$$?; \
	docker compose -f $(TEST_COMPOSE) down; \
	[ $$status -eq 0 ] || exit $$status
	@echo "Running forgemail tests"
	@docker run --rm -v "$(CURDIR)/srcs/forgemail:/src:ro" docker.io/library/node:22-slim \
		sh -c 'cp -r /src /app && cd /app && npm ci --silent && npm test'

# Runs the bot's C++ and real rules-daemon transport suites inside Docker.
test-bot:
	$(MAKE) -C srcs/bot docker-test

# Puzzle unit, database and HTTP tests in the same isolated Docker stack as CI.
test-puzzles:
	@docker compose -f $(TEST_COMPOSE) --profile tests run --rm --build tests npm run test:puzzles; \
	status=$$?; \
	docker compose -f $(TEST_COMPOSE) down; \
	exit $$status

# Rebuilds and restarts everything. Data (database, dashboards, backups) is kept.
re: clean
	$(MAKE)

# Stops and removes the containers. Data (database, dashboards, backups) is kept.
clean:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down --remove-orphans
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down --remove-orphans
	docker compose -f ./backup/docker-compose.yml down --remove-orphans

# Also deletes the database, Prometheus and Grafana volumes. The backups
# folder is kept. Asks first, unless FORCE=1.
fclean:
	@if [ "$(FORCE)" != "1" ]; then \
		printf "This deletes the database and every volume of the stack (backups are kept). Continue? [y/N] "; \
		read answer; \
		[ "$$answer" = "y" ] || [ "$$answer" = "Y" ] || { echo "Cancelled."; exit 1; }; \
	fi
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down -v --remove-orphans
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down -v --remove-orphans
	docker compose -f ./backup/docker-compose.yml down -v --remove-orphans

.PHONY: all puzzles loud dev env down backup backup-down backup-logs backup-now backups restore full stop-app start-app check-monitoring test test-bot test-puzzles re clean fclean
