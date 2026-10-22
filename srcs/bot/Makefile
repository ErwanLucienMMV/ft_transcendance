NAME		:= chess_bot
BUILD_DIR	:= build
TARGET		:= $(BUILD_DIR)/$(NAME)
TEST_TARGET	:= $(BUILD_DIR)/bot_tests
RULES_DIR	:= ../chess-engine
RULES_TARGET	:= $(RULES_DIR)/build/chess_engine

CXX		?= c++
PYTHON		?= python3
CXXFLAGS	?= -O2 -g
WARNINGS	:= -Wall -Wextra -Wpedantic -Werror
INCLUDES	:= -Iinclude -I$(RULES_DIR)/include
LDLIBS		+= -pthread

CORE_SOURCES	:= src/engine.cpp src/search.cpp src/evaluation.cpp src/protocol.cpp
SERVER_SOURCES	:= src/main.cpp src/listener.cpp src/session.cpp
TEST_SOURCES	:= tests/bot_tests.cpp
CORE_OBJECTS	:= $(CORE_SOURCES:%.cpp=$(BUILD_DIR)/%.o) $(BUILD_DIR)/rules/chess.o
SERVER_OBJECTS	:= $(SERVER_SOURCES:%.cpp=$(BUILD_DIR)/%.o)
TEST_OBJECTS	:= $(TEST_SOURCES:%.cpp=$(BUILD_DIR)/%.o)
DEPENDENCIES	:= $(CORE_OBJECTS:.o=.d) $(SERVER_OBJECTS:.o=.d) $(TEST_OBJECTS:.o=.d)

.PHONY: all test integration-test check docker-test format format-check clean fclean re

all: $(TARGET)

$(TARGET): $(CORE_OBJECTS) $(SERVER_OBJECTS)
	$(CXX) $(LDFLAGS) $^ $(LDLIBS) -o $@

$(TEST_TARGET): $(CORE_OBJECTS) $(TEST_OBJECTS)
	$(CXX) $(LDFLAGS) $^ $(LDLIBS) -o $@

$(BUILD_DIR)/%.o: %.cpp
	@mkdir -p $(@D)
	$(CXX) $(CPPFLAGS) $(INCLUDES) $(CXXFLAGS) $(WARNINGS) -std=c++17 -MMD -MP -c $< -o $@

$(BUILD_DIR)/rules/chess.o: $(RULES_DIR)/src/chess.cpp
	@mkdir -p $(@D)
	$(CXX) $(CPPFLAGS) $(INCLUDES) $(CXXFLAGS) $(WARNINGS) -std=c++17 -MMD -MP -c $< -o $@

test: $(TEST_TARGET)
	./$(TEST_TARGET)

# The rules daemon remains a separate executable during transport tests.
integration-test: $(TARGET)
	$(MAKE) -C $(RULES_DIR) CPPFLAGS="-Iinclude $(CPPFLAGS)"
	$(PYTHON) tests/integration_test.py $(TARGET) $(RULES_TARGET)

check: test integration-test

# Runs both native and real-daemon transport tests inside the Docker test stage.
docker-test:
	docker build --target test -f Dockerfile -t transcendence-bot-tests ..
	docker run --rm transcendence-bot-tests

format:
	clang-format -i include/bot/*.hpp src/*.cpp tests/*.cpp

format-check:
	clang-format --dry-run --Werror include/bot/*.hpp src/*.cpp tests/*.cpp

clean:
	rm -rf $(BUILD_DIR)/src $(BUILD_DIR)/tests $(BUILD_DIR)/rules

fclean: clean
	rm -f $(TARGET) $(TEST_TARGET)

re: fclean
	$(MAKE) all

-include $(DEPENDENCIES)
