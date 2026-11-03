#include "bot/engine.hpp"
#include "bot/protocol.hpp"

#include <functional>
#include <iostream>
#include <nlohmann/json.hpp>
#include <set>
#include <stdexcept>
using namespace bot;
using namespace chess;
using Json = nlohmann::json;

namespace {
int checks = 0;

void require(bool test, const std::string &message)
{
	++checks;
	if (!test) {
		throw std::runtime_error(message);
	}
}

void rejects(const std::function<void()> &fn)
{
	bool threw = false;
	try {
		fn();
	} catch (const std::invalid_argument &) {
		threw = true;
	}
	require(threw, "Expected rejection");
}
} // namespace

int main()
{
	try {
		SearchEngine engine(42);
		for (auto d : {Difficulty::Easy, Difficulty::Medium, Difficulty::Hard}) {
			require(parseDifficulty(difficultyName(d)) == d, "Difficulty roundtrip");
			auto limits = limitsFor(d);
			require(limits.depth >= 1 && limits.nodes > 0 && limits.time.count() > 0,
				"Bounded difficulty");
			for (const auto &fen : {
					 "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
					 "4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1",	 // pin
					 "7k/8/8/r4pPK/8/8/8/8 w - f6 0 2",		 // illegal EP due to pin
					 "7k/P7/8/8/8/8/8/7K w - - 0 1",		 // promotion
					 "7k/8/8/3pP3/4K3/8/8/8 w - d6 0 2",	 // EP evades check
					 "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1", // black castles/captures
					 "4r2k/8/8/8/1b6/8/R7/4K3 w - - 0 1"	 // double check
				 }) {
				auto p = position(fen, {});
				auto result = engine.bestMove(p, d);
				require(result.move.has_value() && p.board.isLegal(*result.move),
					"Always legal at " + difficultyName(d));
				require(
					result.nodes <= limits.nodes && result.depth <= limits.depth, "Search bounds");
				require(result.elapsedMs < limits.time.count() + 1000, "Soft deadline");
			}
			auto mate = position("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", {});
			auto result = engine.bestMove(mate, d);
			require(result.move && mate.board.play(*result.move).checkmate(),
				"Mate in one at " + difficultyName(d));
			auto capture = position("7k/8/8/8/3q4/8/8/K2R4 w - - 0 1", {});
			require(engine.bestMove(capture, d).move->uci() == "d1d4",
				"Win hanging queen at " + difficultyName(d));
			for (auto fen : {"7k/6Q1/5K2/8/8/8/8/8 b - - 0 1", "7k/5K2/6Q1/8/8/8/8/8 b - - 0 1",
					 "7k/8/8/8/8/8/8/K7 w - - 0 1"}) {
				require(!engine.bestMove(position(fen, {}), d).move, "Terminal has no move");
			}
		}
		require(limitsFor(Difficulty::Easy).nodes < limitsFor(Difficulty::Medium).nodes &&
				limitsFor(Difficulty::Medium).nodes < limitsFor(Difficulty::Hard).nodes,
			"Distinct node budgets");
		auto mateTwo = position("7k/8/5K2/5Q2/8/8/8/8 w - - 0 1", {});
		auto planned = engine.bestMove(mateTwo, Difficulty::Hard);
		require(planned.move && planned.score >= 29997 && planned.depth >= 3,
			"Hard finds forced mate in two");
		auto afterPlan = mateTwo.board.play(*planned.move);
		for (const auto &reply : afterPlan.legalMoves()) {
			auto final = afterPlan.play(reply);
			bool matingReply = false;
			for (const auto &move : final.legalMoves()) {
				if (final.play(move).checkmate()) {
					matingReply = true;
				}
			}
			require(matingReply, "Mate in two verified for every defense");
		}
		// Variety: the same position does not always get the same answer, but tactics hold.
		auto italian =
			position("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", {});
		for (auto d : {Difficulty::Easy, Difficulty::Medium}) {
			std::set<std::string> played;
			for (std::uint64_t seed = 0; seed < 24; ++seed) {
				auto result = SearchEngine(seed).bestMove(italian, d);
				require(result.move && italian.board.isLegal(*result.move) && !result.book,
					"Varied move is legal");
				played.insert(result.move->uci());
			}
			require(played.size() >= 2, "Varied play at " + difficultyName(d));
		}
		for (std::uint64_t seed = 0; seed < 24; ++seed) {
			SearchEngine seeded(seed);
			auto mateOne = position("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", {});
			auto mate = seeded.bestMove(mateOne, Difficulty::Easy);
			require(mate.move && mateOne.board.play(*mate.move).checkmate(),
				"A mate is never spoiled by variety");
			auto queen = position("7k/8/8/8/3q4/8/8/K2R4 w - - 0 1", {});
			require(seeded.bestMove(queen, Difficulty::Easy).move->uci() == "d1d4",
				"An easy mistake never leaves a queen");
		}
		// EASY's node budget finishes its one ply in busy middlegames, despite the wider root
		// window. The clock is left out: a loaded test machine must not decide the result.
		Limits easyNodes = limitsFor(Difficulty::Easy);
		easyNodes.time = std::chrono::seconds(30);
		for (const auto *fen : {"r2q1rk1/1b1nbppp/p2ppn2/1p6/3NP3/1BN1B3/PPP1QPPP/R4RK1 w - - 0 11",
				 "2rq1rk1/pb1nbppp/1p2pn2/2pp4/2PP4/1P2PN2/PB1NBPPP/2RQ1RK1 w - - 0 12"}) {
			for (std::uint64_t seed = 0; seed < 8; ++seed) {
				require(SearchEngine(seed)
							.search(position(fen, {}), easyNodes, styleFor(Difficulty::Easy))
							.depth == 1,
					"EASY completes its ply");
			}
		}
		{
			// A first iteration cut short plays a move it scored, not the unsearched first one
			// (here the queen takes a pawn defended by a pawn).
			auto defended = position("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1", {});
			auto cut = SearchEngine(1).search(defended, {1, 12, std::chrono::milliseconds(100)});
			require(cut.depth == 0 && cut.move && cut.move->uci() != "d1d5",
				"A cut first iteration keeps a searched move");
		}
		{
			// The reported score is the one of the move played: when EASY picks a move below its
			// best, it says so.
			bool lower = false;
			for (std::uint64_t seed = 0; seed < 24; ++seed) {
				auto best = SearchEngine(seed).search(italian, easyNodes, Style{});
				auto easy =
					SearchEngine(seed).search(italian, easyNodes, styleFor(Difficulty::Easy));
				require(easy.score <= best.score, "Easy score never above the best");
				lower = lower || easy.score < best.score;
			}
			require(lower, "Easy reports the score of a weaker move it played");
		}
		auto replayed = [&](std::uint64_t seed) {
			return SearchEngine(seed).bestMove(italian, Difficulty::Medium).move->uci();
		};
		require(replayed(7) == replayed(7), "Same seed, same move");
		// Opening book: varied first moves, transpositions recognized, only legal moves.
		std::set<std::string> openings;
		for (std::uint64_t seed = 0; seed < 24; ++seed) {
			auto start = position("", {});
			auto result = SearchEngine(seed).bestMove(start, Difficulty::Hard);
			require(result.book && result.depth == 0 && start.board.isLegal(*result.move),
				"Book opening move");
			openings.insert(result.move->uci());
		}
		require(openings.size() >= 2, "Varied openings");
		auto transposed = position("", {"c2c4", "g8f6", "d2d4"});
		auto reply = SearchEngine(3).bestMove(transposed, Difficulty::Medium);
		require(reply.book && (reply.move->uci() == "e7e6" || reply.move->uci() == "g7g6"),
			"Book follows transpositions");
		auto outOfBook = position("", {"a2a3"});
		require(!SearchEngine(3).bestMove(outOfBook, Difficulty::Medium).book,
			"Unknown openings are searched");
		require(!engine.search(position("", {}), limitsFor(Difficulty::Hard)).book,
			"Plain search ignores the book");
		auto p = position("", {"e2e4", "e7e5"});
		require(p.board.fen().find(" e6 0 2") != std::string::npos && p.history.size() == 3,
			"History replay");
		auto fallback = engine.search(p, {5, 1, std::chrono::milliseconds(1000)});
		require(fallback.move && p.board.isLegal(*fallback.move) && fallback.depth == 0 &&
				fallback.nodes == 1,
			"Legal fallback on exhausted budget");
		auto once = engine.search(p, {2, 50000, std::chrono::seconds(5)});
		auto twice = engine.search(p, {2, 50000, std::chrono::seconds(5)});
		require(once.move->uci() == twice.move->uci() && once.score == twice.score,
			"Deterministic search");
		rejects([] {
			parseDifficulty("EXPERT");
		});
		rejects([] {
			position("bad", {});
		});
		rejects([] {
			position("", {"e2e5"});
		});
		auto call = [](Json j) {
			return Json::parse(handleRequest(j.dump()));
		};
		for (auto d : {"EASY", "MEDIUM", "HARD"}) {
			auto reply =
				call({{"id", "test"}, {"op", "best_move"}, {"difficulty", d}, {"moves", {"e2e4"}}});
			require(reply["ok"] == true && reply["id"] == "test", "Protocol envelope");
			auto b = position("", {"e2e4"}).board;
			auto move = Move::parse(reply["result"]["bestMove"].get<std::string>());
			require(b.isLegal(move) && b.play(move).fen() == reply["result"]["fenAfter"],
				"Protocol move and FEN");
		}
		auto seeded = [&](Json seed) {
			return call({{"op", "best_move"}, {"difficulty", "MEDIUM"}, {"seed", seed},
				{"fen", "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"}});
		};
		require(seeded(11)["result"]["bestMove"] == seeded(11)["result"]["bestMove"] &&
				seeded(11)["result"]["book"] == false,
			"Protocol seed replays a move");
		require(call({{"op", "best_move"}, {"difficulty", "EASY"}})["result"]["book"] == true,
			"Protocol reports book moves");
		for (auto seed : {Json(-1), Json(1.5), Json("1"), Json(nullptr)}) {
			require(seeded(seed)["ok"] == false, "Invalid seed rejected");
		}
		require(call({{"op", "ping"}})["result"]["service"] == "chess_bot", "Ping");
		for (auto request :
			std::vector<Json>{Json::array(), nullptr, Json::object(), {{"op", "bad"}},
				{{"op", "best_move"}}, {{"op", "best_move"}, {"difficulty", "hard"}},
				{{"op", "best_move"}, {"difficulty", "EASY"}, {"moves", "e2e4"}},
				{{"op", "best_move"}, {"difficulty", "EASY"}, {"moves", {"e2e5"}}},
				{{"op", "best_move"}, {"difficulty", "EASY"}, {"fen", ""}}}) {
			require(call(request)["ok"] == false, "Invalid request rejected");
		}
		require(Json::parse(handleRequest("{"))["ok"] == false, "Invalid JSON");
		require(
			Json::parse(handleRequest(std::string(131073, 'x')))["ok"] == false, "Message size");
		auto terminal = call({{"op", "best_move"}, {"difficulty", "HARD"},
			{"fen", "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1"}});
		require(
			terminal["result"]["bestMove"].is_null() && terminal["result"]["status"] == "checkmate",
			"Terminal wire response");
		std::cout << "PASS " << checks
				  << " bot checks (all difficulties, legality, tactics, bounds, variety, book, "
					 "protocol)\n";
		return 0;
	} catch (const std::exception &e) {
		std::cerr << "FAIL after " << checks << " checks: " << e.what() << '\n';

		return 1;
	}
}
