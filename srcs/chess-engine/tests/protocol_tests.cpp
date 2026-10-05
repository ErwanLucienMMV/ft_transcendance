#include "chess/protocol.hpp"

#include <nlohmann/json.hpp>

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Json = nlohmann::json;

int checks = 0;

void check(bool condition, const std::string& message) {
    ++checks;

    if (!condition) {
        throw std::runtime_error(
            "Protocol check " +
            std::to_string(checks) +
            ": " +
            message
        );
    }
}

Json call(const Json& request) {
    return Json::parse(
        chess::handleRequest(request.dump())
    );
}

void checkInvalidRequest(const Json& request) {
    const auto result = call(request);

    check(
        result["ok"] == false,
        "Request should fail"
    );

    check(
        result["error"]["code"] == "invalid_request",
        "Request should return invalid_request"
    );
}

// -----------------------------------------------------------------------------
// Basic operations
// -----------------------------------------------------------------------------

void testPing() {
    const auto result = call({
        {"id", "hello"},
        {"op", "ping"},
    });

    check(
        result["ok"] == true,
        "Ping should succeed"
    );

    check(
        result["id"] == "hello",
        "Ping should preserve request id"
    );

    check(
        result["result"]["protocolVersion"] == 1,
        "Unexpected protocol version"
    );
}

void testLegalMoves() {
    const auto result = call({
        {"id", 42},
        {"op", "legal_moves"},
    });

    check(
        result["ok"] == true,
        "legal_moves should succeed"
    );

    check(
        result["id"] == 42,
        "Request id should be preserved"
    );

    check(
        result["result"]["legalMoves"].size() == 20,
        "Initial position should have 20 legal moves"
    );
}

void testValidation() {
    const auto illegal = call({
        {"op", "validate"},
        {"move", "e2e5"},
    });

    check(
        illegal["ok"] == true,
        "Invalid move validation should succeed"
    );

    check(
        illegal["result"]["legal"] == false,
        "e2e5 should be illegal"
    );

    const auto legal = call({
        {"op", "validate"},
        {"move", "e2e4"},
    });

    check(
        legal["ok"] == true,
        "Valid move validation should succeed"
    );

    check(
        legal["result"]["legal"] == true,
        "e2e4 should be legal"
    );
}

// -----------------------------------------------------------------------------
// Moves and game state
// -----------------------------------------------------------------------------

void testMove() {
    const auto result = call({
        {"op", "move"},
        {"moves", {"e2e4"}},
        {"move", "e7e5"},
    });

    check(
        result["ok"] == true,
        "move should succeed"
    );

    check(
        result["result"]["fen"] ==
            "rnbqkbnr/pppp1ppp/8/4p3/"
            "4P3/8/PPPP1PPP/RNBQKBNR "
            "w KQkq e6 0 2",
        "Unexpected FEN after e4 e5"
    );
}

void testRejectedMove() {
    checkInvalidRequest({
        {"op", "move"},
        {"move", "e2e5"},
    });
}

void testRequestsAreIndependent() {
    const auto initial = call({
        {"op", "analyze"},
    });

    const auto rejected = call({
        {"op", "move"},
        {"move", "e2e5"},
    });

    check(
        rejected["ok"] == false,
        "Illegal move should be rejected"
    );

    const auto afterFailure = call({
        {"op", "analyze"},
    });

    check(
        afterFailure["result"]["fen"] ==
            initial["result"]["fen"],
        "Rejected request must not modify later requests"
    );
}

// -----------------------------------------------------------------------------
// Game endings and draw rules
// -----------------------------------------------------------------------------

void testCheckmate() {
    const auto result = call({
        {"op", "analyze"},
        {
            "moves",
            {
                "f2f3",
                "e7e5",
                "g2g4",
                "d8h4",
            },
        },
    });

    check(
        result["result"]["checkmate"] == true,
        "Fool's mate should be checkmate"
    );

    check(
        result["result"]["winner"] == "black",
        "Black should win Fool's mate"
    );
}

void testThreefoldRepetition() {
    const auto result = call({
        {"op", "analyze"},
        {
            "moves",
            {
                "g1f3",
                "g8f6",
                "f3g1",
                "f6g8",
                "g1f3",
                "g8f6",
                "f3g1",
                "f6g8",
            },
        },
    });

    check(
        result["result"]["threefoldClaimable"] == true,
        "Position should be claimable by threefold repetition"
    );

    check(
        result["result"]["status"] == "ongoing",
        "Threefold repetition should not automatically end the game"
    );
}

void testFiftyMoveRule() {
    const auto result = call({
        {"op", "analyze"},
        {
            "fen",
            "7k/8/8/8/8/8/P7/KN6 "
            "w - - 100 51",
        },
    });

    check(
        result["result"]["fiftyMoveClaimable"] == true,
        "100 halfmoves should be claimable"
    );
}

void testStalemate() {
    const auto result = call({
        {"op", "analyze"},
        {
            "fen",
            "7k/5K2/6Q1/8/8/8/8/8 "
            "b - - 0 1",
        },
    });

    check(
        result["result"]["status"] == "stalemate",
        "Position should be stalemate"
    );
}

void testInsufficientMaterial() {
    const auto result = call({
        {"op", "analyze"},
        {
            "fen",
            "7k/8/8/8/8/8/8/K7 "
            "w - - 0 1",
        },
    });

    check(
        result["result"]["status"] ==
            "insufficient_material",
        "King versus king should be insufficient material"
    );
}

// -----------------------------------------------------------------------------
// Invalid requests
// -----------------------------------------------------------------------------

void testInvalidRequests() {
    const std::vector<Json> requests = {
        nullptr,

        Json::array(),

        Json::object(),

        {
            {"op", "bad"},
        },

        {
            {"op", "move"},
        },

        {
            {"op", "move"},
            {"move", "e2e5"},
        },

        {
            {"op", "analyze"},
            {"fen", "invalid"},
        },

        {
            {"op", "analyze"},
            {"moves", "e2e4"},
        },

        {
            {"op", "analyze"},
            {"moves", {123}},
        },

        {
            {"op", "analyze"},
            {"moves", {"e2e5"}},
        },

        {
            {"op", "ping"},
            {"id", Json::object()},
        },

        {
            {"op", 9},
        },

        {
            {"op", "validate"},
            {"move", "a7a8k"},
        },
    };

    for (const auto& request : requests) {
        checkInvalidRequest(request);
    }
}

void testMalformedJson() {
    const auto result =
        Json::parse(
            chess::handleRequest("{")
        );

    check(
        result["ok"] == false,
        "Malformed JSON should be rejected"
    );

    check(
        result["error"]["code"] == "invalid_request",
        "Malformed JSON should return invalid_request"
    );
}

void testOversizedRequest() {
    const auto result =
        Json::parse(
            chess::handleRequest(
                std::string(131073, ' ')
            )
        );

    check(
        result["ok"] == false,
        "Oversized request should be rejected"
    );
}

void testTooManyMoves() {
    Json history = Json::array();

    for (int i = 0; i < 2049; ++i) {
        history.push_back("e2e4");
    }

    checkInvalidRequest({
        {"op", "analyze"},
        {"moves", history},
    });
}

} // namespace

int main() {
    using Test = std::pair<
        const char*,
        void (*)()
    >;

    const std::vector<Test> tests = {
        {"ping", testPing},
        {"legal moves", testLegalMoves},
        {"validation", testValidation},
        {"move", testMove},
        {"rejected move", testRejectedMove},
        {"independent requests", testRequestsAreIndependent},
        {"checkmate", testCheckmate},
        {"threefold repetition", testThreefoldRepetition},
        {"fifty-move rule", testFiftyMoveRule},
        {"stalemate", testStalemate},
        {"insufficient material", testInsufficientMaterial},
        {"invalid requests", testInvalidRequests},
        {"malformed JSON", testMalformedJson},
        {"oversized request", testOversizedRequest},
        {"too many moves", testTooManyMoves},
    };

    int failed = 0;

    for (const auto& [name, test] : tests) {
        const int checksBefore = checks;

        try {
            test();

            std::cout
                << "[PASS] "
                << name
                << " ("
                << checks - checksBefore
                << " checks)\n";
        } catch (const std::exception& error) {
            ++failed;

            std::cerr
                << "[FAIL] "
                << name
                << ": "
                << error.what()
                << '\n';
        }
    }

    std::cout
        << '\n'
        << checks
        << " checks, "
        << failed
        << " failed suites\n";

    return failed == 0 ? 0 : 1;
}