#include "bot/protocol.hpp"

#include "bot/engine.hpp"

#include <nlohmann/json.hpp>
#include <stdexcept>

namespace bot {
using Json = nlohmann::json;

std::string handleRequest(const std::string &text)
{
	Json id = nullptr;
	try {
		if (text.size() > 131072) {
			throw std::invalid_argument("Request exceeds 128 KiB");
		}
		auto request = Json::parse(text);
		if (!request.is_object()) {
			throw std::invalid_argument("Request must be an object");
		}
		if (request.contains("id")) {
			id = request["id"];
			if (!id.is_null() && !id.is_string() && !id.is_number_integer()) {
				id = nullptr;
				throw std::invalid_argument("Invalid request id");
			}
		}
		auto op = request.at("op").get<std::string>();
		if (op == "ping") {
			return Json{{"id", id}, {"ok", true},
				{"result", {{"service", "chess_bot"}, {"protocolVersion", 1}}}}
				.dump();
		}
		if (op != "best_move") {
			throw std::invalid_argument("Unknown operation");
		}
		auto difficulty = parseDifficulty(request.at("difficulty").get<std::string>());
		std::vector<std::string> moves;
		if (request.contains("moves")) {
			if (!request["moves"].is_array() || request["moves"].size() > 2048) {
				throw std::invalid_argument("Invalid history array");
			}
			moves = request["moves"].get<std::vector<std::string>>();
		}
		if (request.contains("fen") && request["fen"].get<std::string>().empty()) {
			throw std::invalid_argument("FEN must not be empty");
		}
		auto p = position(request.value("fen", std::string{}), moves);
		SearchEngine engine;
		auto result = engine.bestMove(p, difficulty);
		std::string status = p.board.checkmate() ? "checkmate"
			: p.board.stalemate()				 ? "stalemate"
			: p.board.insufficientMaterial()	 ? "insufficient_material"
												 : "ongoing";
		Json response{{"fen", p.board.fen()}, {"difficulty", difficultyName(difficulty)},
			{"status", status}, {"scoreCp", result.score}, {"depth", result.depth},
			{"nodes", result.nodes}, {"elapsedMs", result.elapsedMs}};
		response["bestMove"] = result.move ? Json(result.move->uci()) : Json(nullptr);
		response["fenAfter"] = result.move ? Json(p.board.play(*result.move).fen()) : Json(nullptr);
		return Json{{"id", id}, {"ok", true}, {"result", response}}.dump();
	} catch (const Json::exception &) {
		return Json{{"id", id}, {"ok", false},
			{"error",
				{{"code", "invalid_request"},
					{"message", "Malformed JSON or missing/incorrectly typed field"}}}}
			.dump();
	} catch (const std::invalid_argument &e) {
		return Json{{"id", id}, {"ok", false},
			{"error", {{"code", "invalid_request"}, {"message", e.what()}}}}
			.dump();
	} catch (const std::exception &) {
		return Json{{"id", id}, {"ok", false},
			{"error", {{"code", "internal_error"}, {"message", "Bot search failed"}}}}
			.dump();
	}
}
} // namespace bot
