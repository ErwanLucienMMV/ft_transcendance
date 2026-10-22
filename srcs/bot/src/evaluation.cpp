#include "bot/evaluation.hpp"

#include "bot/constants.hpp"
#include "bot/engine.hpp"

#include <cmath>

namespace bot {
using namespace chess;
using detail::pieceValues;

int evaluate(const BoardState &board)
{
	int white = 0, bishops[2]{0, 0}, material = 0;
	for (auto piece : board.squares) {
		if (piece && piece->type != PieceType::King) {
			material += pieceValues[static_cast<int>(piece->type)];
		}
	}
	for (int i = 0; i < 64; ++i) {
		if (auto piece = board.squares[i]) {
			int file = i % 8, rank = piece->color == ChessColor::White ? i / 8 : 7 - i / 8;
			int center = 7 - (std::abs(2 * file - 7) + std::abs(2 * rank - 7)) / 2;
			int score = pieceValues[static_cast<int>(piece->type)];
			switch (piece->type) {
			case PieceType::Pawn:
				score += rank * 7 + center * 3;
				if (rank >= 5) {
					score += (rank - 4) * 20;
				}
				break;
			case PieceType::Knight:
				score += center * 11;
				if (rank == 0) {
					score -= 15;
				}
				break;
			case PieceType::Bishop:
				score += center * 5;
				++bishops[static_cast<int>(piece->color)];
				break;
			case PieceType::Rook:
				if (rank == 6) {
					score += 20;
				}
				break;
			case PieceType::Queen:
				score += center * 2;
				break;
			case PieceType::King:
				if (material < 2200) {
					score += center * 10;
				} else {
					score -= center * 8 + rank * 6;
					if (rank == 0 && (file == 6 || file == 2)) {
						score += 45;
					}
					int forward = piece->color == ChessColor::White ? 1 : -1;
					int rank = i / 8 + forward;
					for (int df = -1; df <= 1; ++df) {
						if (rank >= 0 && rank < 8 && file + df >= 0 && file + df < 8) {
							auto shield = board.at(Square(file + df, rank));
							if (shield && shield->color == piece->color &&
								shield->type == PieceType::Pawn) {
								score += 12;
							}
						}
					}
				}
				break;
			}
			white += piece->color == ChessColor::White ? score : -score;
		}
	}
	if (bishops[0] >= 2) {
		white += 30;
	}
	if (bishops[1] >= 2) {
		white -= 30;
	}

	return board.turn == ChessColor::White ? white : -white;
}

} // namespace bot
