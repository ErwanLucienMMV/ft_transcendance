CXX      ?= c++

BUILD    := build
TARGET   := $(BUILD)/chess_engine

CPPFLAGS := -Iinclude
CXXFLAGS := -std=c++17 -g -Wall -Wextra -Wpedantic -Werror
LDLIBS   := -pthread

ENGINE_SOURCES := \
	src/main.cpp \
	src/chess.cpp \
	src/protocol.cpp \
	src/server.cpp \
	src/listener.cpp \
	src/session.cpp

ENGINE_OBJECTS := $(ENGINE_SOURCES:%.cpp=$(BUILD)/%.o)

CHESS_TEST      := $(BUILD)/chess_tests
PROTOCOL_TEST   := $(BUILD)/protocol_tests

CHESS_TEST_SRC := \
	src/chess.cpp \
	tests/chess_tests.cpp

PROTOCOL_TEST_SRC := \
	src/chess.cpp \
	src/protocol.cpp \
	tests/protocol_tests.cpp

CHESS_TEST_OBJ := $(CHESS_TEST_SRC:%.cpp=$(BUILD)/%.o)

PROTOCOL_TEST_OBJ := $(PROTOCOL_TEST_SRC:%.cpp=$(BUILD)/%.o)

DEPS := \
	$(ENGINE_OBJECTS:.o=.d) \
	$(CHESS_TEST_OBJ:.o=.d) \
	$(PROTOCOL_TEST_OBJ:.o=.d)

.PHONY: all test clean

all: $(TARGET)

test: $(CHESS_TEST) $(PROTOCOL_TEST)
	$(CHESS_TEST)
	$(PROTOCOL_TEST)

$(TARGET): $(ENGINE_OBJECTS)
	@mkdir -p $(@D)
	$(CXX) $(ENGINE_OBJECTS) $(LDLIBS) -o $@

$(CHESS_TEST): $(CHESS_TEST_OBJ)
	@mkdir -p $(@D)
	$(CXX) $(CHESS_TEST_OBJ) $(LDLIBS) -o $@

$(PROTOCOL_TEST): $(PROTOCOL_TEST_OBJ)
	@mkdir -p $(@D)
	$(CXX) $(PROTOCOL_TEST_OBJ) $(LDLIBS) -o $@

$(BUILD)/%.o: %.cpp
	@mkdir -p $(@D)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -MMD -MP -c $< -o $@

-include $(DEPS)

clean:
	rm -rf $(BUILD)