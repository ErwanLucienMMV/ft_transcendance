CXX ?= c++
CPPFLAGS += -Iinclude
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -Werror
LDLIBS += -pthread
BUILD := build
.PHONY: all test clean
all: $(BUILD)/chess_engine
$(BUILD):
	mkdir -p $@
$(BUILD)/chess_engine: src/chess.cpp src/protocol.cpp src/server.cpp include/chess/chess.hpp include/chess/protocol.hpp | $(BUILD)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/chess.cpp src/protocol.cpp src/server.cpp $(LDLIBS) -o $@
$(BUILD)/chess_tests: src/chess.cpp tests/chess_tests.cpp include/chess/chess.hpp | $(BUILD)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/chess.cpp tests/chess_tests.cpp -o $@
$(BUILD)/protocol_tests: src/chess.cpp src/protocol.cpp tests/protocol_tests.cpp include/chess/chess.hpp include/chess/protocol.hpp | $(BUILD)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/chess.cpp src/protocol.cpp tests/protocol_tests.cpp -o $@
test: $(BUILD)/chess_tests $(BUILD)/protocol_tests
	$(BUILD)/chess_tests
	$(BUILD)/protocol_tests
clean:
	rm -rf $(BUILD)
