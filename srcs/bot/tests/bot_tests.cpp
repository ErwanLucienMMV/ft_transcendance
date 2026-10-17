#include "bot/engine.hpp"
#include <nlohmann/json.hpp>
#include <iostream>
#include <stdexcept>
#include <functional>
using namespace bot;
using namespace chess;
using Json = nlohmann::json;
namespace {
int checks = 0;
void require(bool test, const std::string& message) { ++checks; if (!test) throw std::runtime_error(message); }
void rejects(const std::function<void()>& fn) { bool threw = false; try { fn(); } catch (const std::invalid_argument&) { threw = true; } require(threw, "Expected rejection"); }
}
int main() {
    try {
        SearchEngine engine;
        for (auto d : {Difficulty::Easy, Difficulty::Medium, Difficulty::Hard}) {
            require(parseDifficulty(difficultyName(d)) == d, "Difficulty roundtrip");
            auto limits = limitsFor(d);
            require(limits.depth >= 1 && limits.nodes > 0 && limits.time.count() > 0, "Bounded difficulty");
            for (const auto& fen : {
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1", // pin
                "7k/8/8/r4pPK/8/8/8/8 w - f6 0 2", // illegal EP due to pin
                "7k/P7/8/8/8/8/8/7K w - - 0 1", // promotion
                "7k/8/8/3pP3/4K3/8/8/8 w - d6 0 2", // EP evades check
                "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1", // black castles/captures
                "4r2k/8/8/8/1b6/8/R7/4K3 w - - 0 1" // double check
            }) {
                auto p = position(fen, {});
                auto result = engine.bestMove(p, d);
                require(result.move.has_value() && p.board.isLegal(*result.move), "Always legal at " + difficultyName(d));
                require(result.nodes <= limits.nodes && result.depth <= limits.depth, "Search bounds");
                require(result.elapsedMs < limits.time.count() + 1000, "Soft deadline");
            }
            auto mate = position("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", {});
            auto result = engine.bestMove(mate, d);
            require(result.move && mate.board.play(*result.move).checkmate(), "Mate in one at " + difficultyName(d));
            auto capture = position("7k/8/8/8/3q4/8/8/K2R4 w - - 0 1", {});
            require(engine.bestMove(capture, d).move->uci() == "d1d4", "Win hanging queen at " + difficultyName(d));
            for (auto fen : {"7k/6Q1/5K2/8/8/8/8/8 b - - 0 1", "7k/5K2/6Q1/8/8/8/8/8 b - - 0 1", "7k/8/8/8/8/8/8/K7 w - - 0 1"}) {
                require(!engine.bestMove(position(fen, {}), d).move, "Terminal has no move");
            }
        }
        require(limitsFor(Difficulty::Easy).nodes < limitsFor(Difficulty::Medium).nodes && limitsFor(Difficulty::Medium).nodes < limitsFor(Difficulty::Hard).nodes, "Distinct node budgets");
        auto mateTwo = position("7k/8/5K2/5Q2/8/8/8/8 w - - 0 1", {});
        auto planned = engine.bestMove(mateTwo, Difficulty::Hard);
        require(planned.move && planned.score >= 29997 && planned.depth >= 3, "Hard finds forced mate in two");
        auto afterPlan = mateTwo.board.play(*planned.move);
        for (const auto& reply : afterPlan.legalMoves()) {
            auto final = afterPlan.play(reply);
            bool matingReply = false;
            for (const auto& move : final.legalMoves()) if (final.play(move).checkmate()) matingReply = true;
            require(matingReply, "Mate in two verified for every defense");
        }
        auto p = position("", {"e2e4", "e7e5"});
        require(p.board.fen().find(" e6 0 2") != std::string::npos && p.history.size() == 3, "History replay");
        auto fallback = engine.search(p, {5, 1, std::chrono::milliseconds(1000)});
        require(fallback.move && p.board.isLegal(*fallback.move) && fallback.depth == 0 && fallback.nodes == 1, "Legal fallback on exhausted budget");
        auto once = engine.search(p, {2, 50000, std::chrono::seconds(5)});
        auto twice = engine.search(p, {2, 50000, std::chrono::seconds(5)});
        require(once.move->uci() == twice.move->uci() && once.score == twice.score, "Deterministic search");
        rejects([] { parseDifficulty("EXPERT"); }); rejects([] { position("bad", {}); }); rejects([] { position("", {"e2e5"}); });
        auto call = [](Json j) { return Json::parse(handleRequest(j.dump())); };
        for (auto d : {"EASY", "MEDIUM", "HARD"}) {
            auto reply = call({{"id", "test"}, {"op", "best_move"}, {"difficulty", d}, {"moves", {"e2e4"}}});
            require(reply["ok"] == true && reply["id"] == "test", "Protocol envelope");
            auto b = position("", {"e2e4"}).board;
            auto move = Move::parse(reply["result"]["bestMove"].get<std::string>());
            require(b.isLegal(move) && b.play(move).fen() == reply["result"]["fenAfter"], "Protocol move and FEN");
        }
        require(call({{"op", "ping"}})["result"]["service"] == "chess_bot", "Ping");
        for (auto request : std::vector<Json>{Json::array(), nullptr, Json::object(),
            {{"op", "bad"}}, {{"op", "best_move"}}, {{"op", "best_move"}, {"difficulty", "hard"}},
            {{"op", "best_move"}, {"difficulty", "EASY"}, {"moves", "e2e4"}},
            {{"op", "best_move"}, {"difficulty", "EASY"}, {"moves", {"e2e5"}}},
            {{"op", "best_move"}, {"difficulty", "EASY"}, {"fen", ""}}}) {
            require(call(request)["ok"] == false, "Invalid request rejected");
        }
        require(Json::parse(handleRequest("{"))["ok"] == false, "Invalid JSON");
        require(Json::parse(handleRequest(std::string(131073, 'x')))["ok"] == false, "Message size");
        auto terminal = call({{"op", "best_move"}, {"difficulty", "HARD"}, {"fen", "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1"}});
        require(terminal["result"]["bestMove"].is_null() && terminal["result"]["status"] == "checkmate", "Terminal wire response");
        std::cout << "PASS " << checks << " bot checks (all difficulties, legality, tactics, bounds, protocol)\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n'; return 1; }
}
