FROM docker.io/library/debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make libboost-dev nlohmann-json3-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srcs
# The shared rules source stays in its existing directory.
COPY chess-engine ./chess-engine
COPY bot ./bot
RUN make -C bot -j2 all

FROM build AS test
# A normal image build must pass these checks before producing the runtime.
RUN make -C bot -j2 check
CMD ["make", "-C", "bot", "check"]

FROM docker.io/library/debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system chessbot && useradd --system --gid chessbot chessbot
COPY --from=test /srcs/bot/build/chess_bot /usr/local/bin/chess_bot
USER chessbot
ENV BOT_HOST=0.0.0.0 BOT_PORT=8082
EXPOSE 8082
ENTRYPOINT ["chess_bot"]
