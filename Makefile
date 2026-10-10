COMPOSE_DIR	= srcs
COMPOSE_FILE	= docker-compose.yml
DEV_COMPOSE	= docker-compose.dev.yml
TEST_COMPOSE	= $(COMPOSE_DIR)/nestJS/42chess/test/docker-compose.yml

all:
	@echo "Starting the building of images, be patient this can take a loooong time"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build -d > compose.log 2>&1
	@echo "Images have been built, now comes running them"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) logs >> compose.log 2>&1
	@echo "All set, feel free to test it"

loud:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build

dev:
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) up

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

test:
	@docker compose -f $(TEST_COMPOSE) run --rm --build tests; \
	status=$$?; \
	docker compose -f $(TEST_COMPOSE) down; \
	[ $$status -eq 0 ] || exit $$status
	@echo "Running forgemail tests"
	@docker run --rm -v "$(CURDIR)/srcs/forgemail:/src:ro" node:22-slim \
		sh -c 'cp -r /src /app && cd /app && npm ci --silent && npm test'

re: clean
	$(MAKE)

clean:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down -v
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down -v
	docker compose -f ./backup/docker-compose.yml down -v

.PHONY: all loud dev down backup backup-down backup-logs full test re clean
