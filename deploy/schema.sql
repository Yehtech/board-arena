-- =============================================================================
-- World Classic Board Games Arena — PostgreSQL 7-Table Schema & Partial Indexes
-- Reference: 多人棋類遊戲網站 規格書 §6 (Data Model)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. users (Players & Guests)
CREATE TABLE IF NOT EXISTS users (
    id              VARCHAR(64) PRIMARY KEY,
    display_name    VARCHAR(64) NOT NULL,
    locale          VARCHAR(16) NOT NULL DEFAULT 'zh-TW',
    country         VARCHAR(8)  NOT NULL DEFAULT 'TW',
    is_guest        BOOLEAN     NOT NULL DEFAULT TRUE,
    status          VARCHAR(24) NOT NULL DEFAULT 'active', -- active | suspended | deleted
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. auth_identities (OAuth Bindings: Google, Discord, LINE — No Passwords Stored)
CREATE TABLE IF NOT EXISTS auth_identities (
    id               BIGSERIAL PRIMARY KEY,
    user_id          VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         VARCHAR(32) NOT NULL, -- google | discord | line
    provider_subject VARCHAR(128) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_subject)
);

-- 3. games (Every Match across all 8 Board Games)
-- Note: white_user_id = First Mover (Black in Go/Gomoku/Othello, Red in Xiangqi, Sente in Shogi, White in Chess/Draughts/Backgammon)
CREATE TABLE IF NOT EXISTS games (
    id               VARCHAR(64) PRIMARY KEY,
    room_id          VARCHAR(32) NOT NULL,
    game_type        VARCHAR(32) NOT NULL, -- othello | xiangqi | go | gomoku | draughts | chess | shogi | backgammon
    time_control     VARCHAR(16) NOT NULL, -- 3+2 | 5+3 | 10+5
    time_class       VARCHAR(16) NOT NULL, -- bullet | blitz | classical
    rated            BOOLEAN     NOT NULL DEFAULT FALSE,
    status           VARCHAR(24) NOT NULL DEFAULT 'waiting', -- waiting | playing | ended | aborted
    white_user_id    VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    black_user_id    VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    bot_level        VARCHAR(16),          -- easy | normal | hard | master | NULL for PvP
    seed             BIGINT      NOT NULL DEFAULT 0,
    result           VARCHAR(24),          -- white | black | draw | aborted
    end_reason       VARCHAR(48),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ
);

-- Partial Index on active games for fast crash recovery & clock restoration (§6)
CREATE INDEX IF NOT EXISTS idx_games_active_status
    ON games (status, started_at)
    WHERE status IN ('waiting', 'playing');

CREATE INDEX IF NOT EXISTS idx_games_white_user ON games (white_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_black_user ON games (black_user_id, started_at DESC);

-- 4. game_moves (Every Move with Idempotent Sequence Number & Authoritative Server Clock)
CREATE TABLE IF NOT EXISTS game_moves (
    game_id          VARCHAR(64) NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq              INT         NOT NULL,
    player           SMALLINT    NOT NULL, -- 1 or 2
    move             JSONB       NOT NULL,
    clock_ms         BIGINT      NOT NULL,
    played_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, seq)
);

-- 5. ratings (Current Glicko-2 Ratings per Game & Time Class: Start 1500, RD 350, Volatility 0.06)
CREATE TABLE IF NOT EXISTS ratings (
    user_id          VARCHAR(64)      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type        VARCHAR(32)      NOT NULL,
    time_class       VARCHAR(16)      NOT NULL,
    rating           DOUBLE PRECISION NOT NULL DEFAULT 1500.0,
    rd               DOUBLE PRECISION NOT NULL DEFAULT 350.0,
    volatility       DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    games_played     INT              NOT NULL DEFAULT 0,
    wins             INT              NOT NULL DEFAULT 0,
    losses           INT              NOT NULL DEFAULT 0,
    draws            INT              NOT NULL DEFAULT 0,
    last_rated_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, game_type, time_class)
);

-- Partial Index for Official Leaderboard Qualification: games_played >= 20 AND rd < 110 (§3 & §6)
CREATE INDEX IF NOT EXISTS idx_ratings_qualified_leaderboard
    ON ratings (game_type, time_class, rating DESC)
    WHERE games_played >= 20 AND rd < 110.0;

-- 6. rating_history (Transactional Audit Trail of Rating Changes per Rated Match)
CREATE TABLE IF NOT EXISTS rating_history (
    id               BIGSERIAL PRIMARY KEY,
    user_id          VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id          VARCHAR(64) NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    game_type        VARCHAR(32) NOT NULL,
    time_class       VARCHAR(16) NOT NULL,
    before           JSONB       NOT NULL, -- { "rating": 1500.0, "rd": 350.0, "volatility": 0.06 }
    after            JSONB       NOT NULL,
    recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. reports (Player Abuse & Cheating Reports Queue)
CREATE TABLE IF NOT EXISTS reports (
    id               VARCHAR(64) PRIMARY KEY,
    reporter_id      VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id   VARCHAR(64),
    game_id          VARCHAR(64) REFERENCES games(id) ON DELETE SET NULL,
    reason           VARCHAR(64) NOT NULL,
    status           VARCHAR(24) NOT NULL DEFAULT 'pending_review',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
