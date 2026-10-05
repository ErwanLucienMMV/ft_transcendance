#include "chess/chess.hpp"

#include <cstdint>
#include <functional>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace chess;

namespace {

int checks = 0;

void require(bool condition, const std::string& message) {
    ++checks;

    if (!condition) {
        throw std::runtime_error(message);
    }
}

void rejects(const std::function<void()>& fn) {
    bool threw = false;

    try {
        fn();
    } catch (const std::invalid_argument&) {
        threw = true;
    }

    require(threw, "Expected invalid_argument");
}

BoardState fen(const std::string& value) {
    return BoardState::fromFen(value);
}

void legal(
    const BoardState& board,
    const std::string& move,
    bool expected = true
) {
    const bool actual =
        board.isLegal(Move::parse(move));

    require(
        actual == expected,
        move + (expected ? " should be legal"
                         : " should be illegal")
    );
}

BoardState play(
    BoardState board,
    const std::string& move
) {
    return board.play(Move::parse(move));
}

void piece(
    const BoardState& board,
    const std::string& square,
    PieceType type,
    ChessColor color
) {
    const auto value = board.at(Square::parse(square));

    require(
        value &&
            value->type == type &&
            value->color == color,
        "Unexpected piece at " + square
    );
}

void empty(
    const BoardState& board,
    const std::string& square
) {
    require(
        !board.at(Square::parse(square)),
        "Expected " + square + " to be empty"
    );
}

std::set<std::string> moveSet(const BoardState& board) {
    std::set<std::string> result;

    for (const auto& move : board.legalMoves()) {
        result.insert(move.uci());
    }

    return result;
}

std::uint64_t perft(
    const BoardState& board,
    int depth
) {
    if (depth == 0) {
        return 1;
    }

    const auto moves = board.legalMoves();

    if (depth == 1) {
        return moves.size();
    }

    std::uint64_t count = 0;

    for (const auto& move : moves) {
        count += perft(
            board.play(move),
            depth - 1
        );
    }

    return count;
}

// -----------------------------------------------------------------------------
// Basic types, FEN parsing, and serialization
// -----------------------------------------------------------------------------

void typesAndFen() {
    require(
        Square::parse("a1").index() == 0,
        "a1 should have index 0"
    );

    require(
        Square::parse("h8").index() == 63,
        "h8 should have index 63"
    );

    require(
        Square(3, 4).str() == "d5",
        "Square formatting"
    );

    rejects([] {
        Square(-1, 0);
    });

    rejects([] {
        Square::parse("i3");
    });

    rejects([] {
        Square::parse("a0");
    });

    require(
        opposite(ChessColor::White) == ChessColor::Black,
        "White opposite should be black"
    );

    require(
        opposite(ChessColor::Black) == ChessColor::White,
        "Black opposite should be white"
    );

    const auto board = BoardState::initial();

    require(
        board.fen() ==
            "rnbqkbnr/pppppppp/8/8/8/8/"
            "PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "Initial FEN"
    );

    require(
        board.turn == ChessColor::White,
        "Initial side to move"
    );

    require(
        board.legalMoves().size() == 20,
        "Initial legal move count"
    );

    int pieces = 0;

    for (const auto& value : board.squares) {
        if (value) {
            ++pieces;
        }
    }

    require(
        pieces == 32,
        "Initial piece count"
    );

    piece(
        board,
        "e1",
        PieceType::King,
        ChessColor::White
    );

    piece(
        board,
        "d8",
        PieceType::Queen,
        ChessColor::Black
    );

    require(
        !board.inCheck(ChessColor::White),
        "Initial white king should not be in check"
    );

    require(
        !board.inCheck(ChessColor::Black),
        "Initial black king should not be in check"
    );

    const auto afterE4 = play(board, "e2e4");

    require(
        afterE4.fen() ==
            "rnbqkbnr/pppppppp/8/8/4P3/8/"
            "PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
        "Double pawn move FEN"
    );

    require(
        fen(afterE4.fen()).fen() == afterE4.fen(),
        "FEN round trip"
    );

    require(
        afterE4.turn == ChessColor::Black,
        "Turn should change after a move"
    );

    require(
        afterE4.fullmoveNumber == 1,
        "White move should not increment fullmove number"
    );

	const std::vector<std::string> invalidFens = {
		"",
		"8/8/8/8/8/8/8/8 w - - 0 1",
		"4k3/8/8/8/8/8/8/4K3 x - - 0 1",
		"4k3/8/8/8/8/8/8/4K3 w K - 0 1",
		"4k3/8/8/8/8/8/8/4K3 w - a3 0 1",
		"4k3/8/8/8/8/8/8/4K3 w - - 0 0",
		"4k3/8/8/8/8/8/8/4K3 w - - 0 1 extra",
		"4k3/8/8/8/8/8/8/4K3 w - - "
		"18446744073709551616 1",
		"4k3/8/8/8/8/8/8/P3K3 w - - 0 1",
		"8/8/8/8/8/8/4k3/4K3 w - - 0 1",
		"4k3/8/8/8/8/8/8/4R1K1 w - - 0 1",
		"4k3/8/8/8/8/8/8/9K w - - 0 1",
		"r3k2r/8/8/8/8/8/8/R3K2R w KK - 0 1",
	};

    for (const auto& value : invalidFens) {
        rejects([&] {
            fen(value);
        });
    }

    const std::vector<std::string> invalidMoves = {
        "e2e",
        "e2e44",
        "a7a8k",
        "a7a8Q",
        "z2a4",
    };

    for (const auto& move : invalidMoves) {
        rejects([&] {
            Move::parse(move);
        });
    }
}

// -----------------------------------------------------------------------------
// Move parsing and basic movement
// -----------------------------------------------------------------------------

void moveParsing() {
    const std::vector<std::string> validMoves = {
        "a2a3",
        "e2e4",
        "b1c3",
        "e7e8q",
        "a7b8n",
    };

    for (const auto& text : validMoves) {
        const auto move = Move::parse(text);

        require(
            move.uci() == text,
            "Move should round-trip: " + text
        );
    }
}

void movements() {
    const auto board = BoardState::initial();

    const std::vector<std::string> legalMoves = {
        "e2e3",
        "e2e4",
        "b1a3",
        "b1c3",
        "g1f3",
        "g1h3",
    };

    for (const auto& move : legalMoves) {
        legal(board, move);
    }

    const std::vector<std::string> illegalMoves = {
        "e2e5",
        "e2d3",
        "e2e1",
        "e7e5",
        "a1a3",
        "c1h6",
        "d1d4",
        "e1e2",
        "b1b3",
        "b1d2",
        "e2e2",
    };

    for (const auto& move : illegalMoves) {
        legal(board, move, false);
    }

    const auto afterE4 = play(board, "e2e4");

    legal(afterE4, "e7e5");
    legal(afterE4, "e7e6");
    legal(afterE4, "e7e4", false);

    const auto afterE4A6 = play(afterE4, "a7a6");

    legal(afterE4A6, "e4e6", false);
    legal(afterE4A6, "e4e5");

    const auto blocked =
        fen("4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1");

    legal(blocked, "e2e3", false);
    legal(blocked, "e2e4", false);

    const auto bishop =
        fen("8/8/7k/8/3B4/8/8/K7 w - - 0 1");

    legal(bishop, "d4g7");
    legal(bishop, "d4a7");
    legal(bishop, "d4d5", false);

    const auto rook =
        fen("7k/8/8/8/3R4/8/8/K7 w - - 0 1");

    legal(rook, "d4d8");
    legal(rook, "d4h4");
    legal(rook, "d4e5", false);

    const auto queen =
        fen("8/8/7k/8/3Q4/8/8/1K6 w - - 0 1");

    legal(queen, "d4g7");
    legal(queen, "d4d8");
    legal(queen, "d4h4");
    legal(queen, "d4f5", false);

    const auto king =
        fen("7k/8/8/8/3K4/8/8/8 w - - 0 1");

    require(
        king.legalMoves().size() == 8,
        "King should have eight moves"
    );

    legal(king, "d4f4", false);

    const auto adjacentKings =
        fen("8/8/8/4k3/8/4K3/8/8 w - - 0 1");

    legal(adjacentKings, "e3e4", false);

    const auto knight =
        fen("7k/8/8/2PPP3/2PNP3/2PPP3/8/K7 w - - 0 1");

    const std::vector<std::string> knightMoves = {
        "d4b3",
        "d4b5",
        "d4c2",
        "d4c6",
        "d4e2",
        "d4e6",
        "d4f3",
        "d4f5",
    };

    for (const auto& move : knightMoves) {
        legal(knight, move);
    }
}

// -----------------------------------------------------------------------------
// Captures
// -----------------------------------------------------------------------------

void captures() {
    const auto board =
        fen("7k/8/8/2p1p3/3P4/8/8/K7 w - - 9 1");

    legal(board, "d4c5");
    legal(board, "d4e5");
    legal(board, "d4c3", false);

    const auto afterCapture = play(board, "d4e5");

    piece(
        afterCapture,
        "e5",
        PieceType::Pawn,
        ChessColor::White
    );

    empty(afterCapture, "d4");

    require(
        afterCapture.halfmoveClock == 0,
        "Capture should reset halfmove clock"
    );

    const auto black =
        fen("7k/8/8/8/3p4/2P1P3/8/K7 b - - 7 1");

    legal(black, "d4c3");
    legal(black, "d4e3");

    const std::vector<std::pair<std::string, std::string>>
        captureFixtures = {
            {
                "7k/8/8/4p3/3B4/8/8/K7 w - - 6 1",
                "d4e5",
            },
            {
                "7k/8/8/3p4/3R4/8/8/K7 w - - 6 1",
                "d4d5",
            },
            {
                "8/8/7k/3p4/3Q4/8/8/K7 w - - 6 1",
                "d4d5",
            },
            {
                "7k/8/4p3/8/3N4/8/8/K7 w - - 6 1",
                "d4e6",
            },
            {
                "7k/8/8/3p4/3K4/8/8/8 w - - 6 1",
                "d4d5",
            },
        };

    for (const auto& [position, move] : captureFixtures) {
        const auto result = play(fen(position), move);

        require(
            result.halfmoveClock == 0,
            "Capture should reset halfmove clock"
        );
    }

    const auto blocked =
        fen("7k/8/3p4/3P4/3R4/8/8/K7 w - - 0 1");

    legal(blocked, "d4d5", false);
    legal(blocked, "d4d6", false);

    const auto enemyBlock =
        fen("7k/8/3p4/3p4/3R4/8/8/K7 w - - 0 1");

    legal(enemyBlock, "d4d5");
    legal(enemyBlock, "d4d6", false);

    const auto unsafeKing =
        fen("7k/8/3r4/3p4/3K4/8/8/8 w - - 0 1");

    legal(unsafeKing, "d4d5", false);
}

// -----------------------------------------------------------------------------
// Promotion
// -----------------------------------------------------------------------------

void promotions() {
    const std::vector<std::string> promotions = {
        "q",
        "r",
        "b",
        "n",
    };

    for (const auto& suffix : promotions) {
        const auto board =
            fen("7k/P7/8/8/8/8/8/7K w - - 0 1");

        const auto move =
            Move::parse("a7a8" + suffix);

        legal(board, move.uci());

        const auto result = board.play(move);

        require(
            result.at(Square::parse("a8")) &&
                result.at(Square::parse("a8"))->type ==
                    *move.promotion &&
                result.at(Square::parse("a8"))->color ==
                    ChessColor::White,
            "Promotion piece"
        );

        require(
            result.halfmoveClock == 0,
            "Promotion should reset halfmove clock"
        );

        const auto black =
            fen("7k/8/8/8/8/8/p7/7K b - - 0 1");

        legal(
            black,
            "a2a1" + suffix
        );

        const auto capture =
            fen("1r5k/P7/8/8/8/8/8/7K w - - 0 1");

        legal(
            capture,
            "a7b8" + suffix
        );
    }

    const auto board =
        fen("7k/P7/8/8/8/8/8/7K w - - 0 1");

    legal(board, "a7a8", false);

    legal(
        BoardState::initial(),
        "e2e4q",
        false
    );
}

// -----------------------------------------------------------------------------
// Castling
// -----------------------------------------------------------------------------

void castling() {
    const std::string position =
        "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

    const auto board = fen(position);

    legal(board, "e1g1");
    legal(board, "e1c1");

    const auto kingside = play(board, "e1g1");

    piece(
        kingside,
        "g1",
        PieceType::King,
        ChessColor::White
    );

    piece(
        kingside,
        "f1",
        PieceType::Rook,
        ChessColor::White
    );

    empty(kingside, "h1");

    require(
        kingside.castling == 12,
        "White castling rights should be cleared"
    );

    require(
        kingside.halfmoveClock == 1,
        "Castling should increment halfmove clock"
    );

    const auto queenside = play(board, "e1c1");

    piece(
        queenside,
        "c1",
        PieceType::King,
        ChessColor::White
    );

    piece(
        queenside,
        "d1",
        PieceType::Rook,
        ChessColor::White
    );

    const auto black =
        fen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");

    legal(black, "e8g8");
    legal(black, "e8c8");

    piece(
        play(black, "e8c8"),
        "d8",
        PieceType::Rook,
        ChessColor::Black
    );

    legal(
        fen("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1"),
        "e1g1",
        false
    );

    legal(
        fen("4kr2/8/8/8/8/8/8/4K2R w K - 0 1"),
        "e1g1",
        false
    );

    legal(
        fen("4k1r1/8/8/8/8/8/8/4K2R w K - 0 1"),
        "e1g1",
        false
    );

    legal(
        fen("k3r3/8/8/8/8/8/8/4K2R w K - 0 1"),
        "e1g1",
        false
    );

    legal(
        fen("4k3/8/8/8/8/8/8/RN2K3 w Q - 0 1"),
        "e1c1",
        false
    );

    legal(
        fen("1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1"),
        "e1c1"
    );

    require(
        (play(board, "h1h2").castling & 1) == 0,
        "Moving h1 rook clears kingside rights"
    );

    require(
        (play(board, "e1e2").castling & 3) == 0,
        "Moving king clears white castling rights"
    );

    require(
        (play(board, "a1a8").castling & 10) == 0,
        "Capturing corner rook clears castling rights"
    );

    auto rights = board;

    rights = play(rights, "h1h2");
    rights = play(rights, "h8h7");
    rights = play(rights, "h2h1");
    rights = play(rights, "h7h8");

    legal(rights, "e1g1", false);
}

// -----------------------------------------------------------------------------
// En passant
// -----------------------------------------------------------------------------

void enPassant() {
    const auto board =
        fen("7k/8/8/3pP3/8/8/8/K7 w - d6 0 2");

    legal(board, "e5d6");

    const auto result = play(board, "e5d6");

    piece(
        result,
        "d6",
        PieceType::Pawn,
        ChessColor::White
    );

    empty(result, "d5");

    require(
        !result.enPassant,
        "En passant target should be cleared"
    );

    require(
        result.halfmoveClock == 0,
        "En passant should reset halfmove clock"
    );

    const auto black =
        fen("7k/8/8/8/3Pp3/8/8/K7 b - d3 0 2");

    legal(black, "e4d3");

    piece(
        play(black, "e4d3"),
        "d3",
        PieceType::Pawn,
        ChessColor::Black
    );

    auto expired = play(board, "a1a2");
    expired = play(expired, "h8h7");

    legal(expired, "e5d6", false);

    const auto pinned =
        fen("7k/8/8/r4pPK/8/8/8/8 w - f6 0 2");

    legal(pinned, "g5f6", false);

    const auto evasion =
        fen("7k/8/8/3pP3/4K3/8/8/8 w - d6 0 2");

    require(
        evasion.inCheck(ChessColor::White),
        "White should be in check"
    );

    legal(evasion, "e5d6");
}

// -----------------------------------------------------------------------------
// Check, checkmate, stalemate, and pinned pieces
// -----------------------------------------------------------------------------

void checkAndMate() {
    const auto pinned =
        fen("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1");

    legal(pinned, "e2d2", false);
    legal(pinned, "e2e8");
    legal(pinned, "e2e3");

    const auto rookCheck =
        fen("4r2k/8/8/8/8/8/8/4K3 w - - 0 1");

    require(
        rookCheck.inCheck(ChessColor::White),
        "Rook should give check"
    );

    require(
        !rookCheck.checkmate(),
        "Check should not automatically be mate"
    );

    const auto knightCheck =
        fen("7k/8/8/8/8/5n2/8/4K3 w - - 0 1");

    require(
        knightCheck.inCheck(ChessColor::White),
        "Knight should give check"
    );

    const auto bishopCheck =
        fen("7k/8/8/8/1b6/8/8/4K3 w - - 0 1");

    require(
        bishopCheck.inCheck(ChessColor::White),
        "Bishop should give check"
    );

    const auto doubleCheck =
        fen("4r2k/8/8/8/1b6/8/R7/4K3 w - - 0 1");

    for (const auto& move : doubleCheck.legalMoves()) {
        require(
            move.from == Square::parse("e1"),
            "Double check should only allow king moves"
        );
    }

    Game foolsMate;

    for (const auto& move : {
        "f2f3",
        "e7e5",
        "g2g4",
        "d8h4",
    }) {
        foolsMate.play(Move::parse(move));
    }

    require(
        foolsMate.board().checkmate(),
        "Fool's mate should be checkmate"
    );

    require(
        !foolsMate.board().stalemate(),
        "Checkmate should not be stalemate"
    );

    const auto blackMate =
        fen("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1");

    require(
        blackMate.checkmate(),
        "Black should be checkmated"
    );

    require(
        blackMate.legalMoves().empty(),
        "Checkmate should have no legal moves"
    );

    const auto stalemate =
        fen("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1");

    require(
        stalemate.stalemate(),
        "Position should be stalemate"
    );

    require(
        !stalemate.checkmate(),
        "Stalemate should not be checkmate"
    );

    require(
        stalemate.legalMoves().empty(),
        "Stalemate should have no legal moves"
    );

    const auto pinnedAttack =
        fen("4k3/4n3/8/6K1/8/8/8/4R3 w - - 0 1");

    legal(pinnedAttack, "g5f5", false);
}

// -----------------------------------------------------------------------------
// Insufficient material
// -----------------------------------------------------------------------------

void material() {
    const std::vector<std::string> insufficient = {
        "7k/8/8/8/8/8/8/K7 w - - 0 1",
        "7k/8/8/8/8/8/8/KN6 w - - 0 1",
        "7k/8/8/8/8/8/8/KB6 w - - 0 1",
        "5b1k/8/8/8/8/8/8/K1B5 w - - 0 1",
        "7k/8/8/8/8/4B3/8/K1B5 w - - 0 1",
    };

    for (const auto& position : insufficient) {
        require(
            fen(position).insufficientMaterial(),
            "Expected insufficient material"
        );
    }

    const std::vector<std::string> sufficient = {
        "7k/8/8/8/8/8/8/KNN5 w - - 0 1",
        "7k/8/8/8/8/8/8/KNB5 w - - 0 1",
        "6bk/8/8/8/8/8/8/K1B5 w - - 0 1",
        "7k/8/8/8/8/8/P7/K7 w - - 0 1",
        "7k/8/8/8/8/8/8/KR6 w - - 0 1",
    };

    for (const auto& position : sufficient) {
        require(
            !fen(position).insufficientMaterial(),
            "Expected mating material"
        );
    }
}

// -----------------------------------------------------------------------------
// Repetition
// -----------------------------------------------------------------------------

void repetition() {
    Game game;

    require(
        game.repetitionCount() == 1,
        "Initial position should occur once"
    );

    for (int cycle = 0; cycle < 2; ++cycle) {
        for (const auto& move : {
            "g1f3",
            "g8f6",
            "f3g1",
            "f6g8",
        }) {
            game.play(Move::parse(move));
        }

        require(
            game.repetitionCount() ==
                static_cast<unsigned>(cycle + 2),
            "Unexpected repetition count"
        );

        require(
            game.threefoldClaimable() == (cycle == 1),
            "Unexpected threefold claim state"
        );
    }

    auto withEnPassant =
        fen("7k/8/8/3pP3/8/8/8/K7 w - d6 0 2");

    auto withoutEnPassant = withEnPassant;
    withoutEnPassant.enPassant.reset();

    require(
        withEnPassant.repetitionKey() !=
            withoutEnPassant.repetitionKey(),
        "Legal en passant target should affect repetition identity"
    );

    withEnPassant =
        fen("7k/8/8/r4pPK/8/8/8/8 w - f6 0 2");

    withoutEnPassant = withEnPassant;
    withoutEnPassant.enPassant.reset();

    require(
        withEnPassant.repetitionKey() ==
            withoutEnPassant.repetitionKey(),
        "Pinned en passant target should not affect identity"
    );

    auto uncapturable =
        play(BoardState::initial(), "e2e4");

    auto noEnPassant = uncapturable;
    noEnPassant.enPassant.reset();

    require(
        uncapturable.repetitionKey() ==
            noEnPassant.repetitionKey(),
        "Uncapturable en passant target should not affect identity"
    );

    auto castling = BoardState::initial();

    auto withoutCastling = castling;
    withoutCastling.castling = 0;

    require(
        castling.repetitionKey() !=
            withoutCastling.repetitionKey(),
        "Castling rights should affect identity"
    );

    auto blackToMove = castling;
    blackToMove.turn = ChessColor::Black;

    require(
        castling.repetitionKey() !=
            blackToMove.repetitionKey(),
        "Side to move should affect identity"
    );

    auto differentClocks = castling;
    differentClocks.fullmoveNumber = 9;
    differentClocks.halfmoveClock = 14;

    require(
        castling.repetitionKey() ==
            differentClocks.repetitionKey(),
        "Move clocks should not affect repetition identity"
    );

    const std::string before = game.board().fen();

    rejects([&] {
        game.play(Move::parse("e2e5"));
    });

    require(
        game.board().fen() == before,
        "Rejected move should not modify the board"
    );

    require(
        game.repetitionCount() == 3,
        "Rejected move should not modify repetition history"
    );
}

// -----------------------------------------------------------------------------
// Fifty-move rule
// -----------------------------------------------------------------------------

void fiftyMoves() {
    const auto board =
        fen("7k/8/8/8/8/8/P7/KN6 w - - 99 50");

    require(
        !board.fiftyMoveClaimable(),
        "99 halfmoves should not be claimable"
    );

    auto afterKnightMove = play(board, "b1c3");

    require(
        afterKnightMove.fiftyMoveClaimable(),
        "100 halfmoves should be claimable"
    );

    require(
        afterKnightMove.halfmoveClock == 100,
        "Knight move should increment halfmove clock"
    );

    require(
        afterKnightMove.fullmoveNumber == 50,
        "White move should not increment fullmove number"
    );

    auto afterBlackMove =
        play(afterKnightMove, "h8g8");

    require(
        afterBlackMove.fullmoveNumber == 51,
        "Black move should increment fullmove number"
    );

    require(
        afterBlackMove.halfmoveClock == 101,
        "Black quiet move should increment halfmove clock"
    );

    require(
        play(board, "a2a3").halfmoveClock == 0,
        "Pawn move should reset halfmove clock"
    );

    const auto capture =
        fen("7k/8/8/8/8/2p5/8/KN6 w - - 99 50");

    require(
        !play(capture, "b1c3").fiftyMoveClaimable(),
        "Capture should reset fifty-move counter"
    );
}

// -----------------------------------------------------------------------------
// Legal move set sanity checks
// -----------------------------------------------------------------------------

void moveSets() {
    const auto initial = BoardState::initial();

    const auto moves = moveSet(initial);

    require(
        moves.size() == 20,
        "Initial move set should contain 20 unique moves"
    );

    require(
        moves.count("e2e4") == 1,
        "Initial move set should contain e2e4"
    );

    require(
        moves.count("g1f3") == 1,
        "Initial move set should contain g1f3"
    );

    require(
        moves.count("e2e5") == 0,
        "Initial move set should not contain e2e5"
    );

    const auto afterE4 = play(initial, "e2e4");

    require(
        afterE4.legalMoves().size() == 20,
        "Black should have 20 moves after e4"
    );

    require(
        moveSet(afterE4).count("e7e5") == 1,
        "Black should be able to play e7e5"
    );
}

// -----------------------------------------------------------------------------
// Reference perft positions
// -----------------------------------------------------------------------------

void referencePerft() {
    const auto initial = BoardState::initial();

    require(
        perft(initial, 1) == 20,
        "Initial perft depth 1"
    );

    require(
        perft(initial, 2) == 400,
        "Initial perft depth 2"
    );

    require(
        perft(initial, 3) == 8902,
        "Initial perft depth 3"
    );

    require(
        perft(initial, 4) == 197281,
        "Initial perft depth 4"
    );

    const auto kiwipete =
        fen(
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/"
            "1p2P3/2N2Q1p/PPPBBPPP/R3K2R "
            "w KQkq - 0 1"
        );

    require(
        perft(kiwipete, 1) == 48,
        "Kiwipete perft depth 1"
    );

    require(
        perft(kiwipete, 2) == 2039,
        "Kiwipete perft depth 2"
    );

    require(
        perft(kiwipete, 3) == 97862,
        "Kiwipete perft depth 3"
    );

    const auto endgame =
        fen(
            "8/2p5/3p4/KP5r/1R3p1k/"
            "8/4P1P1/8 w - - 0 1"
        );

    require(
        perft(endgame, 3) == 2812,
        "Rook/endgame perft depth 3"
    );

    const auto promotion =
        fen(
            "r3k2r/Pppp1ppp/1b3nbN/nP6/"
            "BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 "
            "w kq - 0 1"
        );

    require(
        perft(promotion, 3) == 9467,
        "Promotion perft depth 3"
    );
}

} // namespace

// -----------------------------------------------------------------------------
// Test runner
// -----------------------------------------------------------------------------

int main() {
    using Test = std::pair<
        std::string,
        std::function<void()>
    >;

    const std::vector<Test> tests = {
        {"types and FEN", typesAndFen},
        {"move parsing", moveParsing},
        {"piece movement", movements},
        {"captures", captures},
        {"promotions", promotions},
        {"castling", castling},
        {"en passant", enPassant},
        {"check and mate", checkAndMate},
        {"material", material},
        {"repetition", repetition},
        {"fifty-move rule", fiftyMoves},
        {"legal move sets", moveSets},
        {"reference perft", referencePerft},
    };

    int failed = 0;

    std::cout << '\n';

    for (const auto& [name, test] : tests) {
        try {
            test();

            std::cout
                << "[PASS] "
                << name
                << '\n';

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

    std::cout << '\n';
    std::cout
        << checks
        << " checks, "
        << failed
        << " failed suites\n";

    return failed == 0 ? 0 : 1;
}