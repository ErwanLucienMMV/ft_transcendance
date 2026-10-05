FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make libboost-dev nlohmann-json3-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN make
RUN make test

RUN python3 tests/websocket_test.py build/chess_engine

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system chess && useradd --system --gid chess chess
COPY --from=build /src/build/chess_engine /usr/local/bin/chess_engine
USER chess
ENV CHESS_ENGINE_HOST=0.0.0.0
ENV CHESS_ENGINE_PORT=8081
EXPOSE 8081
ENTRYPOINT ["chess_engine"]