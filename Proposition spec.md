# Mini Chess — Backend API Technical Specification



**Version:** 1.0

**Status:** Draft

**Backend:** NestJS

**Database:** PostgreSQL

**Frontend:** Angular

**Realtime:** WebSocket

**Reverse Proxy:** Nginx

**Monitoring:** Prometheus + Grafana

**Chess Engine:** In-house chess logic + Stockfish for bots



---



## 1. Architecture



```text

&#x20;                        ┌──────────────┐

&#x20;                        │    Browser   │

&#x20;                        │   Angular    │

&#x20;                        └──────┬───────┘

&#x20;                               │

&#x20;                    HTTP / WebSocket

&#x20;                               │

&#x20;                        ┌──────▼───────┐

&#x20;                        │    Nginx     │

&#x20;                        └──────┬───────┘

&#x20;                               │

&#x20;                        ┌──────▼───────┐

&#x20;                        │    NestJS    │

&#x20;                        │              │

&#x20;                        │ Auth         │

&#x20;                        │ Users        │

&#x20;                        │ Friends      │

&#x20;                        │ Games        │

&#x20;                        │ Matchmaking  │

&#x20;                        │ Chat         │

&#x20;                        │ ELO          │

&#x20;                        │ Puzzles      │

&#x20;                        │ Bots         │

&#x20;                        └──────┬───────┘

&#x20;                               │

&#x20;                      ┌────────┴────────┐

&#x20;                      │                 │

&#x20;               ┌──────▼──────┐   ┌──────▼──────┐

&#x20;               │ PostgreSQL  │   │  Stockfish  │

&#x20;               │             │   │             │

&#x20;               │ Persistent  │   │ Bot engine  │

&#x20;               │ data        │   │             │

&#x20;               └─────────────┘   └─────────────┘

```



### Architectural principles



* PostgreSQL is the persistent source of truth.

* No Redis or external data store.

* WebSockets are used for realtime game communication.

* REST is used for standard CRUD/query operations.

* Game rules are enforced server-side.

* The frontend is never trusted for game state, ELO or game results.

* OAuth providers are optional authentication methods, not application dependencies.

* The core game logic must not depend directly on PostgreSQL, WebSockets or OAuth.



---



# 2. API conventions



## Base URL



```text

/api/v1

```



## Content type



```http

Content-Type: application/json

```



## IDs



All persistent entities use UUIDs.



## Dates



All dates are represented using ISO-8601 UTC timestamps.



Example:



```text

2026-09-19T03:42:17.123Z

```



---



# 3. Authentication



The application supports both local accounts and external OAuth providers.



Supported providers:



* Local

* Google OAuth

* GitHub OAuth



An OAuth provider must never be required for normal application operation.



## 3.1 Register



```http

POST /auth/register

```



### Request



```json

{

&#x20; "username": "alice",

&#x20; "email": "alice@example.com",

&#x20; "password": "password"

}

```



### Response



```json

{

&#x20; "user": {

&#x20;   "id": "uuid",

&#x20;   "username": "alice",

&#x20;   "elo": 1200

&#x20; },

&#x20; "accessToken": "token"

}

```



---



## 3.2 Login



```http

POST /auth/login

```



### Request



```json

{

&#x20; "login": "alice",

&#x20; "password": "password"

}

```



### Response



```json

{

&#x20; "accessToken": "token",

&#x20; "user": {

&#x20;   "id": "uuid",

&#x20;   "username": "alice",

&#x20;   "elo": 1200

&#x20; }

}

```



---



## 3.3 Logout



```http

POST /auth/logout

```



---



## 3.4 OAuth



```http

GET /auth/oauth/google

GET /auth/oauth/google/callback



GET /auth/oauth/github

GET /auth/oauth/github/callback

```



OAuth identities are linked to an internal `User`.



```text

OAuth provider

&#x20;     │

&#x20;     ▼

OAuthIdentity

&#x20;     │

&#x20;     ▼

&#x20;   User

```



The rest of the application only operates on `User`.



---



# 4. User API



## GET `/users/me`



Returns the authenticated user's profile.



### Response



```json

{

&#x20; "id": "uuid",

&#x20; "username": "alice",

&#x20; "avatarUrl": null,

&#x20; "elo": 1428,

&#x20; "gamesPlayed": 87,

&#x20; "gamesWon": 42,

&#x20; "gamesDraw": 11,

&#x20; "gamesLost": 34,

&#x20; "createdAt": "2026-01-01T12:00:00Z"

}

```



---



## PATCH `/users/me`



Updates editable profile information.



### Request



```json

{

&#x20; "username": "alice_new",

&#x20; "avatarUrl": "https://..."

}

```



---



## GET `/users/:id`



Returns a public user profile.



### Response



```json

{

&#x20; "id": "uuid",

&#x20; "username": "alice",

&#x20; "avatarUrl": null,

&#x20; "elo": 1452,

&#x20; "gamesPlayed": 124,

&#x20; "online": true

}

```



---



## GET `/users/search?q=alice`



Searches users by username.



### Response



```json

{

&#x20; "users": [

&#x20;   {

&#x20;     "id": "uuid",

&#x20;     "username": "alice",

&#x20;     "elo": 1452,

&#x20;     "online": true

&#x20;   }

&#x20; ]

}

```



---



# 5. Friends API



## GET `/friends`



Returns the authenticated user's friends.



### Response



```json

{

&#x20; "friends": [

&#x20;   {

&#x20;     "id": "uuid",

&#x20;     "username": "alice",

&#x20;     "elo": 1452,

&#x20;     "status": "ONLINE"

&#x20;   }

&#x20; ]

}

```



---



## POST `/friends/requests`



Send a friend request.



### Request



```json

{

&#x20; "userId": "uuid"

}

```



---



## GET `/friends/requests`



Returns incoming and outgoing requests.



### Response



```json

{

&#x20; "incoming": [],

&#x20; "outgoing": []

}

```



---



## POST `/friends/requests/:id/accept`



Accepts a friend request.



---



## DELETE `/friends/requests/:id`



Rejects or cancels a friend request.



---



## DELETE `/friends/:userId`



Removes a friend.



---



# 6. Game domain



The game system is the core of the application.



```typescript

interface Game {

&#x20;   id: UUID;



&#x20;   whitePlayer: PlayerRef;

&#x20;   blackPlayer: PlayerRef;



&#x20;   status: GameStatus;



&#x20;   timeControl: TimeControl;



&#x20;   board: BoardState;



&#x20;   result: GameResult | null;



&#x20;   startedAt: Date | null;

&#x20;   endedAt: Date | null;



&#x20;   createdAt: Date;

}

```



---



## 6.1 PlayerRef



```typescript

interface PlayerRef {

&#x20;   id: UUID;

&#x20;   username: string;

&#x20;   avatarUrl: string | null;

&#x20;   elo: number;

&#x20;   color: ChessColor;

}

```



---



## 6.2 ChessColor



```typescript

type ChessColor =

&#x20;   | "WHITE"

&#x20;   | "BLACK";

```



---



## 6.3 PieceType



```typescript

type PieceType =

&#x20;   | "PAWN"

&#x20;   | "KNIGHT"

&#x20;   | "BISHOP"

&#x20;   | "ROOK"

&#x20;   | "QUEEN"

&#x20;   | "KING";

```



---



## 6.4 Piece



```typescript

interface Piece {

&#x20;   type: PieceType;

&#x20;   color: ChessColor;

}

```



---



# 7. Board state



The server uses FEN as the canonical representation of the chessboard state.



```typescript

interface BoardState {

&#x20;   fen: string;



&#x20;   turn: ChessColor;



&#x20;   halfmoveClock: number;



&#x20;   fullmoveNumber: number;

}

```



The frontend may maintain its own representation for rendering, but the server remains authoritative.



---



# 8. Time control



```typescript

interface TimeControl {

&#x20;   initialTime: number;

&#x20;   increment: number;

}

```



All values are expressed in milliseconds.



Examples:



```text

1+0

3+2

5+0

10+0

15+10

```



---



# 9. Game status



```typescript

enum GameStatus {

&#x20;   WAITING,

&#x20;   ACTIVE,

&#x20;   FINISHED

}

```



---



# 10. Game result



```typescript

interface GameResult {

&#x20;   winner: ChessColor | null;



&#x20;   reason:

&#x20;       | "CHECKMATE"

&#x20;       | "RESIGNATION"

&#x20;       | "TIMEOUT"

&#x20;       | "DRAW_AGREEMENT"

&#x20;       | "STALEMATE"

&#x20;       | "INSUFFICIENT_MATERIAL"

&#x20;       | "THREEFOLD_REPETITION"

&#x20;       | "FIFTY_MOVE_RULE";

}

```



Example:



```json

{

&#x20; "winner": "WHITE",

&#x20; "reason": "CHECKMATE"

}

```



Draw:



```json

{

&#x20; "winner": null,

&#x20; "reason": "DRAW_AGREEMENT"

}

```



---



# 11. Game REST API



## POST `/games`



Creates a game against a specific opponent or enters matchmaking.



### Request



```json

{

&#x20; "opponentId": "uuid",

&#x20; "timeControl": {

&#x20;   "initialTime": 600000,

&#x20;   "increment": 0

&#x20; }

}

```



For matchmaking:



```json

{

&#x20; "opponentId": null,

&#x20; "timeControl": {

&#x20;   "initialTime": 600000,

&#x20;   "increment": 0

&#x20; }

}

```



### Response



```json

{

&#x20; "gameId": "uuid",

&#x20; "status": "WAITING"

}

```



---



## GET `/games/:id`



Returns the current game state.



### Response



```json

{

&#x20; "id": "uuid",

&#x20; "status": "ACTIVE",



&#x20; "whitePlayer": {},

&#x20; "blackPlayer": {},



&#x20; "board": {

&#x20;   "fen": "...",

&#x20;   "turn": "WHITE",

&#x20;   "halfmoveClock": 0,

&#x20;   "fullmoveNumber": 12

&#x20; },



&#x20; "clocks": {

&#x20;   "white": 542312,

&#x20;   "black": 591822

&#x20; },



&#x20; "result": null

}

```



---



## GET `/games/:id/moves`



Returns the complete move history.



### Response



```json

{

&#x20; "moves": [

&#x20;   {

&#x20;     "number": 1,

&#x20;     "playerId": "uuid",

&#x20;     "from": "e2",

&#x20;     "to": "e4",

&#x20;     "notation": "e4",

&#x20;     "fen": "...",

&#x20;     "timestamp": "2026-09-19T03:42:17Z"

&#x20;   }

&#x20; ]

}

```



---



## GET `/games/live`



Returns currently active games that can be spectated.



### Response



```json

{

&#x20; "games": [

&#x20;   {

&#x20;     "id": "uuid",

&#x20;     "whitePlayer": {},

&#x20;     "blackPlayer": {},

&#x20;     "spectatorCount": 12

&#x20;   }

&#x20; ]

}

```



---



# 12. Move object



```typescript

interface ChessMove {

&#x20;   from: Square;

&#x20;   to: Square;



&#x20;   promotion?: PieceType;



&#x20;   notation: string;



&#x20;   timestamp: Date;



&#x20;   playerId: UUID;

}

```



A move is valid only if:



1. The user is authenticated.

2. The user belongs to the game.

3. The game is active.

4. It is the player's turn.

5. The move is legal.

6. The player has not run out of time.

7. The game has not already ended.



---



# 13. Game state machine



```text

&#x20;                   ┌──────────────┐

&#x20;                   │    WAITING   │

&#x20;                   └──────┬───────┘

&#x20;                          │

&#x20;                    opponent joins

&#x20;                          │

&#x20;                          ▼

&#x20;                   ┌──────────────┐

&#x20;                   │    ACTIVE    │

&#x20;                   └──────┬───────┘

&#x20;                          │

&#x20;             ┌────────────┼─────────────┐

&#x20;             │            │             │

&#x20;          checkmate     resign        draw

&#x20;             │            │             │

&#x20;             └────────────┼─────────────┘

&#x20;                          │

&#x20;                          ▼

&#x20;                   ┌──────────────┐

&#x20;                   │   FINISHED   │

&#x20;                   └──────────────┘

```



A finished game is immutable.



---



# 14. WebSocket API



WebSocket endpoint:



```text

/ws

```



WebSockets are used for realtime game and chat communication.



---



## 14.1 Client → Server events



```text

AUTHENTICATE



JOIN_GAME

LEAVE_GAME



MAKE_MOVE



RESIGN



OFFER_DRAW

ACCEPT_DRAW

DECLINE_DRAW



SEND_GAME_MESSAGE

SEND_PRIVATE_MESSAGE



START_SPECTATING

STOP_SPECTATING

```



---



## 14.2 Server → Client events



```text

AUTHENTICATED



GAME_STATE

MOVE_PLAYED

CLOCK_UPDATE



DRAW_OFFERED

GAME_ENDED



GAME_MESSAGE

PRIVATE_MESSAGE



MATCH_FOUND



USER_ONLINE

USER_OFFLINE

USER_STATUS_CHANGED



ERROR

```



---



# 15. WebSocket authentication



Immediately after opening the WebSocket connection:



```json

{

&#x20; "event": "AUTHENTICATE",

&#x20; "data": {

&#x20;   "accessToken": "token"

&#x20; }

}

```



Server response:



```json

{

&#x20; "event": "AUTHENTICATED",

&#x20; "data": {

&#x20;   "userId": "uuid"

&#x20; }

}

```



Unauthenticated clients cannot access private game or messaging events.



---



# 16. Join game



```json

{

&#x20; "event": "JOIN_GAME",

&#x20; "data": {

&#x20;   "gameId": "uuid"

&#x20; }

}

```



Server responds with:



```text

GAME_STATE

```



---



# 17. Make move



```json

{

&#x20; "event": "MAKE_MOVE",

&#x20; "data": {

&#x20;   "gameId": "uuid",

&#x20;   "from": "e2",

&#x20;   "to": "e4",

&#x20;   "promotion": null

&#x20; }

}

```



The server validates the move before modifying the game.



---



# 18. Move played



```json

{

&#x20; "event": "MOVE_PLAYED",

&#x20; "data": {

&#x20;   "gameId": "uuid",



&#x20;   "move": {

&#x20;     "from": "e2",

&#x20;     "to": "e4",

&#x20;     "notation": "e4"

&#x20;   },



&#x20;   "board": {

&#x20;     "fen": "..."

&#x20;   },



&#x20;   "clocks": {

&#x20;     "white": 598421,

&#x20;     "black": 600000

&#x20;   },



&#x20;   "turn": "BLACK"

&#x20; }

}

```



The event is sent to:



* White player

* Black player

* Spectators



---



# 19. Resignation



Client:



```json

{

&#x20; "event": "RESIGN",

&#x20; "data": {

&#x20;   "gameId": "uuid"

&#x20; }

}

```



Server:



```json

{

&#x20; "event": "GAME_ENDED",

&#x20; "data": {

&#x20;   "gameId": "uuid",

&#x20;   "result": {

&#x20;     "winner": "BLACK",

&#x20;     "reason": "RESIGNATION"

&#x20;   }

&#x20; }

}

```



---



# 20. Draw



## Offer



```json

{

&#x20; "event": "OFFER_DRAW",

&#x20; "data": {

&#x20;   "gameId": "uuid"

&#x20; }

}

```



Server:



```json

{

&#x20; "event": "DRAW_OFFERED",

&#x20; "data": {

&#x20;   "gameId": "uuid",

&#x20;   "playerId": "uuid"

&#x20; }

}

```



## Accept



```json

{

&#x20; "event": "ACCEPT_DRAW",

&#x20; "data": {

&#x20;   "gameId": "uuid"

&#x20; }

}

```



## Decline



```json

{

&#x20; "event": "DECLINE_DRAW",

&#x20; "data": {

&#x20;   "gameId": "uuid"

&#x20; }

}

```



---



# 21. Game chat



## Send message



```json

{

&#x20; "event": "SEND_GAME_MESSAGE",

&#x20; "data": {

&#x20;   "gameId": "uuid",

&#x20;   "content": "Good luck!"

&#x20; }

}

```



## Server broadcast



```json

{

&#x20; "event": "GAME_MESSAGE",

&#x20; "data": {

&#x20;   "id": "uuid",

&#x20;   "gameId": "uuid",

&#x20;   "sender": {

&#x20;     "id": "uuid",

&#x20;     "username": "alice"

&#x20;   },

&#x20;   "content": "Good luck!",

&#x20;   "createdAt": "2026-09-19T03:42:17Z"

&#x20; }

}

```



---



# 22. Private messaging



## GET `/conversations`



```json

{

&#x20; "conversations": [

&#x20;   {

&#x20;     "user": {

&#x20;       "id": "uuid",

&#x20;       "username": "alice"

&#x20;     },

&#x20;     "lastMessage": {},

&#x20;     "unreadCount": 2

&#x20;   }

&#x20; ]

}

```



---



## GET `/conversations/:userId/messages`



```json

{

&#x20; "messages": [

&#x20;   {

&#x20;     "id": "uuid",

&#x20;     "senderId": "uuid",

&#x20;     "receiverId": "uuid",

&#x20;     "content": "Hello",

&#x20;     "createdAt": "2026-09-19T03:42:17Z"

&#x20;   }

&#x20; ]

}

```



---



## SEND_PRIVATE_MESSAGE



```json

{

&#x20; "event": "SEND_PRIVATE_MESSAGE",

&#x20; "data": {

&#x20;   "receiverId": "uuid",

&#x20;   "content": "Hello!"

&#x20; }

}

```



Server:



```json

{

&#x20; "event": "PRIVATE_MESSAGE",

&#x20; "data": {

&#x20;   "id": "uuid",

&#x20;   "senderId": "uuid",

&#x20;   "receiverId": "uuid",

&#x20;   "content": "Hello!",

&#x20;   "createdAt": "2026-09-19T03:42:17Z"

&#x20; }

}

```



Messages are persisted in PostgreSQL.



---



# 23. Matchmaking



## POST `/matchmaking/join`



```json

{

&#x20; "timeControl": {

&#x20;   "initialTime": 600000,

&#x20;   "increment": 0

&#x20; }

}

```



Response:



```json

{

&#x20; "queueId": "uuid",

&#x20; "status": "WAITING"

}

```



---



## DELETE `/matchmaking/leave`



Removes the current user from the matchmaking queue.



---



## MATCH_FOUND



When a match is found:



```json

{

&#x20; "event": "MATCH_FOUND",

&#x20; "data": {

&#x20;   "gameId": "uuid",

&#x20;   "opponent": {

&#x20;     "id": "uuid",

&#x20;     "username": "bob",

&#x20;     "elo": 1452

&#x20;   }

&#x20; }

}

```



---



# 24. Matchmaking object



```typescript

interface MatchmakingEntry {

&#x20;   id: UUID;



&#x20;   userId: UUID;



&#x20;   timeControl: TimeControl;



&#x20;   elo: number;



&#x20;   joinedAt: Date;



&#x20;   status:

&#x20;       | "WAITING"

&#x20;       | "MATCHED"

&#x20;       | "CANCELLED";

}

```



Matchmaking entries are stored in PostgreSQL.



Transactions and row locking must prevent two matchmaking workers from selecting the same player.



PostgreSQL mechanisms such as:



```sql

SELECT ...

FOR UPDATE SKIP LOCKED;

```



may be used for this purpose.



---



# 25. ELO



The ELO rating is updated internally when a game ends.



The client cannot directly modify ELO.



## GET `/users/:id/rating-history`



### Response



```json

{

&#x20; "history": [

&#x20;   {

&#x20;     "gameId": "uuid",

&#x20;     "ratingBefore": 1402,

&#x20;     "ratingAfter": 1420,

&#x20;     "change": 18,

&#x20;     "createdAt": "2026-09-19T03:42:17Z"

&#x20;   }

&#x20; ]

}

```



---



# 26. Rating change



```typescript

interface RatingChange {

&#x20;   id: UUID;



&#x20;   userId: UUID;



&#x20;   gameId: UUID;



&#x20;   ratingBefore: number;

&#x20;   ratingAfter: number;

&#x20;   change: number;



&#x20;   createdAt: Date;

}

```



Initial rating:



```text

1200

```



Standard ELO calculation:



```text

Expected(A) =

1 / (1 + 10 ^ ((Rb - Ra) / 400))

```



```text

Ra' = Ra + K × (Sa - Ea)

```



Where:



```text

Sa = 1      victory

Sa = 0.5    draw

Sa = 0      defeat

```



---



# 27. Bots



Bots use the same game system as human players.



The game engine must not need to know whether a player is human or a bot.



```text

Player

├── Human

└── Bot

&#x20;     │

&#x20;     ▼

&#x20; BotService

&#x20;     │

&#x20;     ▼

&#x20;ChessEngine

&#x20;     │

&#x20;     ▼

&#x20;Stockfish

```



---



## POST `/games/bot`



### Request



```json

{

&#x20; "difficulty": "MEDIUM",

&#x20; "timeControl": {

&#x20;   "initialTime": 600000,

&#x20;   "increment": 0

&#x20; }

}

```



### Response



```json

{

&#x20; "gameId": "uuid"

}

```



---



## Bot difficulty



```typescript

type BotDifficulty =

&#x20;   | "EASY"

&#x20;   | "MEDIUM"

&#x20;   | "HARD";

```



The difficulty configuration is controlled by the backend.



---



# 28. Spectators



## GET `/games/live`



Returns active games available for spectators.



---



## START_SPECTATING



```json

{

&#x20; "event": "START_SPECTATING",

&#x20; "data": {

&#x20;   "gameId": "uuid"

&#x20; }

}

```



The spectator receives:



```text

GAME_STATE

MOVE_PLAYED

GAME_ENDED

```



A spectator cannot send:



```text

MAKE_MOVE

RESIGN

OFFER_DRAW

ACCEPT_DRAW

```



---



# 29. Presence



No external presence service is required.



Active WebSocket connections are maintained in the NestJS process.



Conceptually:



```typescript

Map<UUID, WebSocket>

```



Presence states:



```typescript

interface UserPresence {

&#x20;   userId: UUID;



&#x20;   status:

&#x20;       | "ONLINE"

&#x20;       | "IN_GAME"

&#x20;       | "OFFLINE";



&#x20;   lastSeen: Date;

}

```



Events:



```text

USER_ONLINE

USER_OFFLINE

USER_STATUS_CHANGED

```



Persistent `lastSeen` information is stored in PostgreSQL.



---



# 30. Puzzles



## GET `/puzzles/daily`



Returns the current daily puzzle.



```json

{

&#x20; "id": "uuid",

&#x20; "date": "2026-09-19",

&#x20; "rating": 1450,

&#x20; "fen": "...",

&#x20; "themes": [

&#x20;   "FORK"

&#x20; ]

}

```



The solution must never be sent to the client.



---



## POST `/puzzles/:id/move`



### Request



```json

{

&#x20; "from": "e2",

&#x20; "to": "e4"

}

```



### Response



Correct move:



```json

{

&#x20; "correct": true,

&#x20; "completed": false,

&#x20; "nextPosition": "..."

}

```



Puzzle completed:



```json

{

&#x20; "correct": true,

&#x20; "completed": true

}

```



Incorrect move:



```json

{

&#x20; "correct": false,

&#x20; "completed": false

}

```



---



# 31. Puzzle object



```typescript

interface Puzzle {

&#x20;   id: UUID;



&#x20;   fen: string;



&#x20;   solution: ChessMove[];



&#x20;   rating: number;



&#x20;   themes: PuzzleTheme[];



&#x20;   createdAt: Date;

}

```



---



## Puzzle themes



```typescript

type PuzzleTheme =

&#x20;   | "CHECK"

&#x20;   | "CHECKMATE"

&#x20;   | "FORK"

&#x20;   | "PIN"

&#x20;   | "SKEWER"

&#x20;   | "DISCOVERED_ATTACK"

&#x20;   | "MATE_IN_ONE"

&#x20;   | "MATE_IN_TWO";

```



---



# 32. Daily puzzle



The selected daily puzzle is stored separately.



```typescript

interface DailyPuzzle {

&#x20;   date: string;

&#x20;   puzzleId: UUID;

}

```



Database relation:



```text

DailyPuzzle

&#x20;    │

&#x20;    ▼

&#x20; Puzzle

```



A scheduled backend job selects the puzzle for each day.



---



# 33. Puzzle attempts



```typescript

interface PuzzleAttempt {

&#x20;   id: UUID;



&#x20;   userId: UUID;



&#x20;   puzzleId: UUID;



&#x20;   solved: boolean;



&#x20;   attempts: number;



&#x20;   duration: number;



&#x20;   createdAt: Date;

}

```



---



# 34. Error contract



All API errors use a common structure.



```json

{

&#x20; "statusCode": 400,

&#x20; "code": "INVALID_MOVE",

&#x20; "message": "The move is not legal."

}

```



Known error codes:



```text

AUTH_REQUIRED

INVALID_CREDENTIALS



USER_NOT_FOUND

USERNAME_ALREADY_EXISTS



FRIEND_REQUEST_EXISTS

ALREADY_FRIENDS



GAME_NOT_FOUND

GAME_NOT_ACTIVE

NOT_A_PLAYER

NOT_YOUR_TURN

INVALID_MOVE

GAME_ALREADY_FINISHED



DRAW_NOT_OFFERED



MATCHMAKING_ALREADY_QUEUED

MATCHMAKING_NOT_FOUND



PUZZLE_NOT_FOUND

INVALID_PUZZLE_MOVE

```



---



# 35. Domain model



```text

User

&#x20;│

&#x20;├── OAuthIdentity

&#x20;│

&#x20;├── Friendship

&#x20;│

&#x20;├── FriendRequest

&#x20;│

&#x20;├── Message

&#x20;│

&#x20;├── Game

&#x20;│     │

&#x20;│     ├── GamePlayer

&#x20;│     ├── Move

&#x20;│     └── GameResult

&#x20;│

&#x20;├── RatingChange

&#x20;│

&#x20;├── MatchmakingEntry

&#x20;│

&#x20;└── PuzzleAttempt

&#x20;│

Puzzle

&#x20;│

&#x20;└── DailyPuzzle

```



---



# 36. PostgreSQL model



Initial tables:



```text

users

oauth_accounts



friendships

friend_requests



games

game_players

moves

game_messages



messages



rating_history



matchmaking_queue



puzzles

daily_puzzles

puzzle_attempts

```



---



# 37. Responsibility of each component



## Angular



Responsible for:



* UI

* board rendering

* user interaction

* local visual state

* WebSocket connection

* REST requests



Angular must never be considered authoritative for:



* legal moves

* game result

* ELO

* game clock

* permissions



---



## NestJS



Responsible for:



* authentication

* authorization

* business logic

* game rules

* move validation

* matchmaking

* ELO calculation

* chat

* puzzle validation

* bot management

* WebSocket communication



---



## PostgreSQL



Responsible for persistent data:



* users

* accounts

* friends

* games

* moves

* messages

* ratings

* matchmaking

* puzzles

* puzzle attempts



---



## WebSocket



Responsible for realtime communication:



* game moves

* game state

* clocks

* game events

* game chat

* private messages

* matchmaking notifications

* presence



---



## Nginx



Responsible for:



* HTTPS

* reverse proxy

* Angular static files

* REST routing

* WebSocket proxying



---



# 38. REST endpoint summary



```text

AUTH



POST   /auth/register

POST   /auth/login

POST   /auth/logout



GET    /auth/oauth/google

GET    /auth/oauth/google/callback



GET    /auth/oauth/github

GET    /auth/oauth/github/callback





USERS



GET    /users/me

PATCH  /users/me

GET    /users/:id

GET    /users/search





FRIENDS



GET    /friends

POST   /friends/requests

GET    /friends/requests

POST   /friends/requests/:id/accept

DELETE /friends/requests/:id

DELETE /friends/:userId





GAMES



POST   /games

POST   /games/bot

GET    /games/:id

GET    /games/:id/moves

GET    /games/live





MATCHMAKING



POST   /matchmaking/join

DELETE /matchmaking/leave





RATING



GET    /users/:id/rating-history





MESSAGING



GET    /conversations

GET    /conversations/:userId/messages





PUZZLES



GET    /puzzles/daily

POST   /puzzles/:id/move

```



---



# 39. WebSocket event summary



## Client → Server



```text

AUTHENTICATE



JOIN_GAME

LEAVE_GAME



MAKE_MOVE



RESIGN



OFFER_DRAW

ACCEPT_DRAW

DECLINE_DRAW



SEND_GAME_MESSAGE

SEND_PRIVATE_MESSAGE



START_SPECTATING

STOP_SPECTATING

```



## Server → Client



```text

AUTHENTICATED



GAME_STATE

MOVE_PLAYED

CLOCK_UPDATE



DRAW_OFFERED

GAME_ENDED



GAME_MESSAGE

PRIVATE_MESSAGE



MATCH_FOUND



USER_ONLINE

USER_OFFLINE

USER_STATUS_CHANGED



ERROR

```



---



# 40. Core design rules



### Rule 1 — Server authoritative



```text

Client

&#x20; │

&#x20; │ "e2 → e4"

&#x20; ▼

Server

&#x20; │

&#x20; ├── Validate

&#x20; ├── Apply

&#x20; ├── Persist

&#x20; └── Broadcast

```



---



### Rule 2 — PostgreSQL is the source of truth



Redis is intentionally not used.



Temporary runtime information may exist in NestJS memory, but persistent state belongs in PostgreSQL.



---



### Rule 3 — External authentication is optional



Google/GitHub OAuth can disappear without making the application unusable.



A local account must remain sufficient to use the application.



---



### Rule 4 — Game logic is infrastructure-independent



The core game logic should not directly depend on:



```text

Angular

PostgreSQL

WebSocket

OAuth

Nginx

```



---



### Rule 5 — Game state transitions are controlled by the backend not either's client



For example:



```text

WAITING → ACTIVE

ACTIVE  → FINISHED

```



must be performed by domain logic and not by arbitrary client requests.



---



### Rule 6 — Finished games are immutable



Once:



```text

Game.status = FINISHED

```



the following must never change:



```text

moves

result

players

start/end timestamps

```



ELO changes are recorded separately in `rating_history`.



---



# 41. Recommended NestJS structure



```text

src/

├── auth/

│   ├── controllers/

│   ├── services/

│   ├── strategies/

│   └── dto/

│

├── users/

│

├── friends/

│

├── games/

│   ├── controllers/

│   ├── gateways/

│   ├── services/

│   ├── domain/

│   ├── repositories/

│   ├── dto/

│   └── entities/

│

├── matchmaking/

│

├── chat/

│

├── rating/

│

├── puzzles/

│

├── bots/

│

├── metrics/

│

└── common/

&#x20;   ├── guards/

&#x20;   ├── filters/

&#x20;   ├── interceptors/

&#x20;   └── types/

```



---



# 42. Target architecture



```text

&#x20;                        ┌──────────────┐

&#x20;                        │   Angular    │

&#x20;                        └──────┬───────┘

&#x20;                               │

&#x20;                    HTTP / WebSocket

&#x20;                               │

&#x20;                        ┌──────▼───────┐

&#x20;                        │    Nginx     │

&#x20;                        └──────┬───────┘

&#x20;                               │

&#x20;                        ┌──────▼───────┐

&#x20;                        │    NestJS    │

&#x20;                        │              │

&#x20;                        │ Auth         │

&#x20;                        │ Users        │

&#x20;                        │ Friends      │

&#x20;                        │ Games        │

&#x20;                        │ Matchmaking  │

&#x20;                        │ Chat         │

&#x20;                        │ Rating       │

&#x20;                        │ Puzzles      │

&#x20;                        │ Bots         │

&#x20;                        └──────┬───────┘

&#x20;                               │

&#x20;                    ┌──────────┴──────────┐

&#x20;                    │                     │

&#x20;             ┌──────▼──────┐       ┌──────▼──────┐

&#x20;             │ PostgreSQL  │       │  Stockfish  │

&#x20;             └─────────────┘       └─────────────┘

&#x20;                    │

&#x20;                    │ metrics

&#x20;                    ▼

&#x20;              ┌─────────────┐

&#x20;              │ Prometheus  │

&#x20;              └──────┬──────┘

&#x20;                     │

&#x20;              ┌──────▼──────┐

&#x20;              │   Grafana    │

&#x20;              └─────────────┘

```



---



# 43. API implementation priority



The recommended implementation order is:



```text

1. Authentication

2. Users

3. Chess domain / Game state machine

4. Game persistence

5. WebSocket game communication

6. Game clocks

7. Resignation / Draw

8. ELO

9. Matchmaking

10. Friends

11. Private chat

12. Spectators

13. Bots

14. Puzzles

15. Monitoring

```



The most important contract to finalize before implementation is the **Game domain and its state machine**. Once `Game`, `Move`, `Player`, `Clock` and `GameResult` are stable, the REST and WebSocket APIs can be implemented as interfaces around that domain.



