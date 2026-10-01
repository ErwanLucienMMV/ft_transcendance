COMPOSE_DIR	= srcs
COMPOSE_FILE	= docker-compose.yml
DEV_COMPOSE	= docker-compose.dev.yml

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

re: clean
	$(MAKE)

clean:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down -v
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) down -v

.PHONY: all dev re clean
