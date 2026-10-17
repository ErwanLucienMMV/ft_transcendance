CXX ?= c++
CPPFLAGS += -Iinclude -I../chess-engine/include
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -Werror
LDLIBS += -pthread
CORE = ../chess-engine/src/chess.cpp src/engine.cpp
.PHONY: all test clean
all: build/chess_bot
build:
	mkdir -p $@
build/chess_bot: $(CORE) src/protocol.cpp src/server.cpp include/bot/engine.hpp ../chess-engine/include/chess/chess.hpp | build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE) src/protocol.cpp src/server.cpp $(LDLIBS) -o $@
build/bot_tests: $(CORE) src/protocol.cpp tests/bot_tests.cpp include/bot/engine.hpp ../chess-engine/include/chess/chess.hpp | build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE) src/protocol.cpp tests/bot_tests.cpp $(LDLIBS) -o $@
test: build/bot_tests
	./build/bot_tests
clean:
	rm -rf build
