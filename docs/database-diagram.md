# Diagramme DB (DOC-16 / SCRUM-523)

Ce diagramme reflète les clés étrangères du schéma migré. Les attributs affichés
sont un sous-ensemble ; consulter le [dictionnaire complet](../srcs/nestJS/42chess/DATABASE-MODEL.md)
pour les types, champs nullables, contraintes et index. La source autonome est
[database-diagram.mmd](database-diagram.mmd).

```mermaid
erDiagram
    daily_puzzles {
        uuid id PK
        uuid puzzleId FK
        date date
    }
    friend_requests {
        uuid id PK
        uuid senderId FK
        uuid recipientId FK
        string status
    }
    friendships {
        uuid id PK
        uuid userId FK
        uuid friendId FK
    }
    game_messages {
        uuid id PK
        uuid gameId FK
        uuid userId FK
    }
    game_players {
        uuid id PK
        uuid gameId FK
        uuid userId FK
        string color
    }
    games {
        uuid id PK
        string status
        uuid invitedOpponentId FK
    }
    matchmaking_queue {
        uuid id PK
        uuid userId FK
        int rating
        string status
    }
    messages {
        uuid id PK
        uuid senderId FK
        uuid recipientId FK
    }
    moves {
        uuid id PK
        uuid gameId FK
        string color
        int ply
    }
    oauth_accounts {
        uuid id PK
        uuid userId FK
        string provider
        string providerUserId
    }
    puzzle_attempts {
        uuid id PK
        uuid userId FK
        uuid puzzleId FK
    }
    puzzles {
        uuid id PK
        int rating
    }
    rating_history {
        uuid id PK
        uuid userId FK
        uuid gameId FK
        int ratingBefore
        int ratingAfter
    }
    users {
        uuid id PK
        string username
        string email
    }
    puzzles ||..o{ daily_puzzles : puzzleId
    users ||..o{ friend_requests : recipientId
    users ||..o{ friend_requests : senderId
    users ||..o{ friendships : friendId
    users ||..o{ friendships : userId
    games ||..o{ game_messages : gameId
    users ||..o{ game_messages : userId
    games ||..o{ game_players : gameId
    users ||..o{ game_players : userId
    users o|..o{ games : invitedOpponentId
    users ||..o| matchmaking_queue : userId
    users ||..o{ messages : recipientId
    users ||..o{ messages : senderId
    games ||..o{ moves : gameId
    game_players ||..o{ moves : gameId_color
    users ||..o{ oauth_accounts : userId
    puzzles ||..o{ puzzle_attempts : puzzleId
    users ||..o{ puzzle_attempts : userId
    games ||..o{ rating_history : gameId
    users ||..o{ rating_history : userId
```

`||` indique un parent obligatoire, `o|` zéro ou un, `o{` zéro ou plusieurs.
Les relations pointillées sont non identifiantes : chaque table enfant conserve
son propre UUID. Une partie peut avoir zéro à deux sièges, contrainte par les
couleurs et leur unicité ; Mermaid représente ici la relation générale un-à-plusieurs.
`moves` référence également le siège via la paire `(gameId, color)`.
Un utilisateur peut être invité dans plusieurs parties et chaque partie peut
avoir zéro ou un invité. Une entrée de queue est unique par utilisateur.
Les deux liens pour les messages, demandes et amitiés représentent deux rôles
sur la même table utilisateur, pas deux copies de données.
