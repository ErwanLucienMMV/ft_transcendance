COMPOSE_DIR	= srcs
COMPOSE_FILE	= docker-compose.yml
DEV_COMPOSE	= docker-compose.dev.yml
TEST_COMPOSE	= $(COMPOSE_DIR)/nestJS/42chess/test/docker-compose.yml

all: env
	@echo "Starting the building of images, be patient this can take a loooong time"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build -d > compose.log 2>&1
	@echo "Images have been built, now comes running them"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) logs >> compose.log 2>&1
	@echo "All set, feel free to test it"

loud: env
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build

dev: env
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) up

# Creates srcs/.env with random secrets, or fills the ones it lacks.
env:
	@sh $(COMPOSE_DIR)/init-env.sh

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

full: all
	@echo "Main stack is ready, starting the independent backup service"
	@docker compose -f backup/docker-compose.yml up --build -d
	@echo "All set, feel free to test it"

stop-app:
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) stop chess-engine nginx prometheus nestjs grafana

start-app:
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) start chess-engine nginx prometheus nestjs grafana

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

re: clean
	$(MAKE)

clean:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down -v
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down -v
	docker compose -f ./backup/docker-compose.yml down -v

.PHONY: all loud dev env down backup backup-down backup-logs full test test-bot test-puzzles re clean
