#include "chess/chess.hpp"
#include "chess/protocol.hpp"

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <string>

namespace chess {

using Json = nlohmann::json;

	namespace {

		Json snapshot(const Game& game, bool withMoves) {
			const auto& board = game.board();

			const auto moves = board.legalMoves();
			const bool inCheck = board.inCheck(board.turn);

			const bool checkmate = inCheck && moves.empty();
			const bool stalemate = !inCheck && moves.empty();
			const bool insufficientMaterial = board.insufficientMaterial();

			std::string status;

			if (checkmate) {
				status = "checkmate";
			} else if (stalemate) {
				status = "stalemate";
			} else if (insufficientMaterial) {
				status = "insufficient_material";
			} else {
				status = "ongoing";
			}

			Json result = {
				{"fen", board.fen()},
				{"turn", board.turn == ChessColor::White ? "white" : "black"},
				{"check", inCheck},
				{"checkmate", checkmate},
				{"stalemate", stalemate},
				{"insufficientMaterial", insufficientMaterial},
				{"status", status},
				{"repetitionCount", game.repetitionCount()},
				{"threefoldClaimable", game.threefoldClaimable()},
				{"fiftyMoveClaimable", board.fiftyMoveClaimable()},
			};

			result["winner"] = checkmate
				? Json(board.turn == ChessColor::White ? "black" : "white")
				: Json(nullptr);

			if (withMoves) {
				result["legalMoves"] = Json::array();

				for (const auto& move : moves) {
					result["legalMoves"].push_back(move.uci());
				}
			}

			return result;
		}

	} // namespace

	std::string handleRequest(const std::string& text) {
		Json id = nullptr;

		try {
			if (text.size() > 131072) {
				throw std::invalid_argument("Request exceeds 128 KiB");
			}

			const Json request = Json::parse(text);

			if (!request.is_object()) {
				throw std::invalid_argument("Request must be an object");
			}

			if (request.contains("id")) {
				const auto& requestId = request["id"];

				if (!requestId.is_string() &&
					!requestId.is_number_integer() &&
					!requestId.is_null()) {
					throw std::invalid_argument(
						"id must be a string, integer, or null"
					);
				}

				id = requestId;
			}

			const std::string op = request.at("op").get<std::string>();

			if (op == "ping") {
				return Json{
					{"id", id},
					{"ok", true},
					{"result", {
						{"service", "chess_engine"},
						{"protocolVersion", 1},
					}},
				}.dump();
			}

			if (op != "analyze" &&
				op != "legal_moves" &&
				op != "validate" &&
				op != "move") {
				throw std::invalid_argument("Unknown operation");
			}

			Game game(
				request.contains("fen")
					? BoardState::fromFen(request.at("fen").get<std::string>())
					: BoardState::initial()
			);

			if (request.contains("moves")) {
				const auto& moves = request.at("moves");

				if (!moves.is_array() || moves.size() > 2048) {
					throw std::invalid_argument(
						"moves must be an array of at most 2048 UCI moves"
					);
				}

				for (const auto& move : moves) {
					game.play(Move::parse(move.get<std::string>()));
				}
			}

			Json result;

			if (op == "validate") {
				const auto move = Move::parse(
					request.at("move").get<std::string>()
				);

				result = {
					{"legal", game.board().isLegal(move)},
					{"fen", game.board().fen()},
				};
			} else {
				if (op == "move") {
					game.play(
						Move::parse(request.at("move").get<std::string>())
					);
				}

				result = snapshot(game, true);
			}

			return Json{
				{"id", id},
				{"ok", true},
				{"result", result},
			}.dump();

		} catch (const Json::exception&) {
			return Json{
				{"id", id},
				{"ok", false},
				{"error", {
					{"code", "invalid_request"},
					{
						"message",
						"Malformed JSON or missing/incorrectly typed field",
					},
				}},
			}.dump();

		} catch (const std::invalid_argument& e) {
			return Json{
				{"id", id},
				{"ok", false},
				{"error", {
					{"code", "invalid_request"},
					{"message", e.what()},
				}},
			}.dump();

		} catch (const std::exception&) {
			return Json{
				{"id", id},
				{"ok", false},
				{"error", {
					{"code", "internal_error"},
					{"message", "Engine could not process request"},
				}},
			}.dump();
		}
	}

} // namespace chess
