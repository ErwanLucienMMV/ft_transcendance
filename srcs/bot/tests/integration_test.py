#!/usr/bin/env python3
"""Real bot + real rules daemon, standard library only; run from any directory."""
import concurrent.futures
import json
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'chess-engine' / 'tests'))
from websocket_test import Client


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def start(binary):
    number = port()
    process = subprocess.Popen([str(Path(binary).resolve()), '--port', str(number)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(process.stderr.read().decode())
        try:
            client = Client(number)
            client.close()
            return process, number
        except ConnectionRefusedError:
            time.sleep(0.05)
    process.terminate()
    raise RuntimeError('Startup timed out')


def main():
    bot, bot_port = start(sys.argv[1])
    engine = None
    clients = []
    try:
        engine, engine_port = start(sys.argv[2])
        b, e = Client(bot_port), Client(engine_port)
        clients.extend([b, e])
        assert b.request({'op': 'ping'})['result']['service'] == 'chess_bot'
        stats = []
        for difficulty in ['EASY', 'MEDIUM', 'HARD']:
            request = {'id': difficulty, 'op': 'best_move', 'difficulty': difficulty, 'moves': ['e2e4', 'e7e5']}
            response = b.request(request)
            assert response['ok'] and response['id'] == difficulty, response
            result = response['result']
            validate = e.request({'op': 'validate', 'moves': request['moves'], 'move': result['bestMove']})
            assert validate['ok'] and validate['result']['legal']
            moved = e.request({'op': 'move', 'moves': request['moves'], 'move': result['bestMove']})
            assert moved['result']['fen'] == result['fenAfter']
            stats.append((difficulty, result['bestMove'], result['depth'], result['nodes'], result['elapsedMs']))
        # A shallow tactical search must find an actual mate confirmed by the rules service.
        fen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1'
        response = b.request({'op': 'best_move', 'difficulty': 'HARD', 'fen': fen})['result']
        assert e.request({'op': 'move', 'fen': fen, 'move': response['bestMove']})['result']['checkmate']
        b.send('{')
        assert not json.loads(b.read()[1])['ok']
        b.send('{"op":"best_', final=False)
        b.send('move","difficulty":"EASY"}', opcode=0)
        assert json.loads(b.read()[1])['ok']
        assert b.request({'op': 'ping'})['ok']
        # Independent clients and concurrent searches must never share a board.
        def query(index):
            client = Client(bot_port)
            try:
                reply = client.request({'id': index, 'op': 'best_move', 'difficulty': 'EASY'})
                assert reply['ok'] and reply['id'] == index
                return reply['result']['bestMove']
            finally:
                client.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            assert len(list(pool.map(query, range(8)))) == 8
        terminal = b.request({'op': 'best_move', 'difficulty': 'MEDIUM', 'fen': '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1'})
        assert terminal['result']['bestMove'] is None
        for payload, opcode, expected in [('binary', 2, 1003), ('x' * 131073, 1, 1009)]:
            other = Client(bot_port)
            clients.append(other)
            other.send(payload, opcode=opcode)
            kind, data = other.read()
            assert kind == 8 and int.from_bytes(data[:2], 'big') == expected
        bot.send_signal(signal.SIGTERM)
        assert bot.wait(timeout=8) == 0
        for stat in stats:
            print('difficulty=%s move=%s completed_depth=%s nodes=%s elapsed_ms=%s' % stat)
        print('PASS real bot/rules WebSocket integration: all difficulties, legality, mate, errors, concurrency, frame limits, shutdown')
    finally:
        for client in clients:
            client.close()
        for process in [bot, engine]:
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=8)
                error = process.stderr.read().decode()
                if error:
                    print(error, file=sys.stderr)


if __name__ == '__main__':
    main()
