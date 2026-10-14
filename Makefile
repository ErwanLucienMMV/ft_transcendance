COMPOSE_DIR	= srcs
COMPOSE_FILE	= docker-compose.yml
DEV_COMPOSE	= docker-compose.dev.yml
TEST_COMPOSE = $(COMPOSE_DIR)/nestJS/42chess/test/docker-compose.yml

all:
	@echo "Starting the building of images, be patient this can take a loooong time"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build -d > compose.log 2>&1
	@echo "Images have been built, now comes running them"
	@docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) logs >> compose.log 2>&1
	@echo "All set, feel free to test it"


test:
	@docker compose -f $(TEST_COMPOSE) run --rm --build tests; \
	status=$$?; \
	docker compose -f $(TEST_COMPOSE) down; \
	exit $$status

loud:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build

dev:
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) up

down:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down

re: clean
	$(MAKE)

clean:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down -v
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down -v

.PHONY: all dev re clean test
