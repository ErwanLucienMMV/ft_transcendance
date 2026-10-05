#include "chess/protocol.hpp"
#include <nlohmann/json.hpp>
#include <iostream>
#include <stdexcept>
using Json = nlohmann::json;
int main() {
    int checks = 0;
    auto check = [&](bool condition) { ++checks; if (!condition) throw std::runtime_error("Protocol check " + std::to_string(checks)); };
    auto call = [](const Json& request) { return Json::parse(chess::handleRequest(request.dump())); };
    try {
        auto ping = call({{"id", "hello"}, {"op", "ping"}});
        check(ping["ok"] == true && ping["id"] == "hello" && ping["result"]["protocolVersion"] == 1);
        auto initial = call({{"id", 42}, {"op", "legal_moves"}});
        check(initial["ok"] == true && initial["id"] == 42 && initial["result"]["legalMoves"].size() == 20);
        auto invalid = call({{"op", "validate"}, {"move", "e2e5"}});
        check(invalid["ok"] == true && invalid["result"]["legal"] == false);
        auto valid = call({{"op", "validate"}, {"move", "e2e4"}});
        check(valid["result"]["legal"] == true);
        auto move = call({{"op", "move"}, {"moves", {"e2e4"}}, {"move", "e7e5"}});
        check(move["ok"] == true && move["result"]["fen"] == "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2");
        auto mate = call({{"op", "analyze"}, {"moves", {"f2f3", "e7e5", "g2g4", "d8h4"}}});
        check(mate["result"]["checkmate"] == true && mate["result"]["winner"] == "black");
        auto repeat = call({{"op", "analyze"}, {"moves", {"g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"}}});
        check(repeat["result"]["threefoldClaimable"] == true && repeat["result"]["status"] == "ongoing");
        check(call({{"op", "analyze"}, {"fen", "7k/8/8/8/8/8/8/KR6 w - - 100 51"}})["result"]["fiftyMoveClaimable"] == true);
        check(call({{"op", "analyze"}, {"fen", "7k/5K2/6Q1/8/8/8/8/8 b - - 0 1"}})["result"]["status"] == "stalemate");
        check(call({{"op", "analyze"}, {"fen", "7k/8/8/8/8/8/8/K7 w - - 0 1"}})["result"]["status"] == "insufficient_material");
        for (const auto& request : std::vector<Json>{nullptr, Json::array(), Json::object(),
            {{"op", "bad"}}, {{"op", "move"}}, {{"op", "move"}, {"move", "e2e5"}},
            {{"op", "analyze"}, {"fen", "invalid"}}, {{"op", "analyze"}, {"moves", "e2e4"}},
            {{"op", "analyze"}, {"moves", {123}}}, {{"op", "analyze"}, {"moves", {"e2e5"}}},
            {{"op", "ping"}, {"id", Json::object()}}, {{"op", 9}}, {{"op", "validate"}, {"move", "a7a8k"}}}) {
            auto result = call(request); check(result["ok"] == false && result["error"]["code"] == "invalid_request");
        }
        check(Json::parse(chess::handleRequest("{"))["ok"] == false);
        check(Json::parse(chess::handleRequest(std::string(131073, ' ')))["ok"] == false);
        Json longHistory = Json::array(); for (int i = 0; i < 2049; ++i) longHistory.push_back("e2e4");
        check(call({{"op", "analyze"}, {"moves", longHistory}})["ok"] == false);
        // Requests are independent, including after rejected mutations.
        check(call({{"op", "analyze"}})["result"]["fen"] == initial["result"]["fen"]);
        std::cout << "PASS " << checks << " protocol checks\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
