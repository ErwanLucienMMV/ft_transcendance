COMPOSE_DIR	= srcs
COMPOSE_FILE	= docker-compose.yml
DEV_COMPOSE	= docker-compose.dev.yml

all:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) up --build

dev:
	docker compose -f $(COMPOSE_DIR)/$(DEV_COMPOSE) up

re: clean
	$(MAKE)

clean:
	docker compose -f $(COMPOSE_DIR)/$(COMPOSE_FILE) down -v

.PHONY: all dev re clean
