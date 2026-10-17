FROM docker.io/library/debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make libboost-dev nlohmann-json3-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srcs
# Build context is srcs/ so the executable uses the existing rules implementation.
COPY chess-engine ./chess-engine
COPY bot ./bot
RUN make -C bot -j2 && make -C bot test \
    && make -C chess-engine -j2 \
    && python3 bot/tests/integration_test.py bot/build/chess_bot chess-engine/build/chess_engine
FROM docker.io/library/debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system chessbot && useradd --system --gid chessbot chessbot
COPY --from=build /srcs/bot/build/chess_bot /usr/local/bin/chess_bot
USER chessbot
ENV BOT_HOST=0.0.0.0 BOT_PORT=8082
EXPOSE 8082
ENTRYPOINT ["chess_bot"]
