#!/usr/bin/env python3
"""Dependency-free integration test. Starts the real server on an ephemeral port."""
import base64
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import time


class Client:
    def __init__(self, port):
        self.sock = socket.create_connection(('127.0.0.1', port), timeout=5)
        self.stream = self.sock.makefile('rb')
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n'
                           f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        assert b'101' in self.stream.readline()
        headers = {}
        while True:
            line = self.stream.readline()
            if line == b'\r\n':
                break
            name, value = line.decode().split(':', 1)
            headers[name.lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        assert headers['sec-websocket-accept'] == expected

    def send(self, payload, opcode=1, final=True):
        if isinstance(payload, str):
            payload = payload.encode()
        size = len(payload)
        header = bytes([(0x80 if final else 0) | opcode])
        if size < 126:
            header += bytes([0x80 | size])
        elif size < 65536:
            header += bytes([0xFE]) + struct.pack('!H', size)
        else:
            header += bytes([0xFF]) + struct.pack('!Q', size)
        mask = os.urandom(4)
        self.sock.sendall(header + mask + bytes(x ^ mask[i % 4] for i, x in enumerate(payload)))

    def read(self):
        first, second = self.stream.read(2)
        size = second & 127
        if size == 126:
            size = struct.unpack('!H', self.stream.read(2))[0]
        elif size == 127:
            size = struct.unpack('!Q', self.stream.read(8))[0]
        assert not second & 0x80, 'Server frames must not be masked'
        payload = self.stream.read(size)
        return first & 15, payload

    def request(self, value):
        self.send(json.dumps(value))
        opcode, payload = self.read()
        assert opcode == 1
        return json.loads(payload)

    def close(self):
        self.stream.close()
        self.sock.close()


def main():
    binary = Path(sys.argv[1] if len(sys.argv) > 1 else 'build/chess_engine').resolve()
    with socket.socket() as reserved:
        reserved.bind(('127.0.0.1', 0))
        port = reserved.getsockname()[1]
    proc = subprocess.Popen([str(binary), '--port', str(port)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    clients = []
    try:
        for _ in range(100):
            if proc.poll() is not None:
                raise RuntimeError(proc.stderr.read().decode())
            try:
                c = Client(port)
                clients.append(c)
                break
            except ConnectionRefusedError:
                time.sleep(0.05)
        else:
            raise RuntimeError('Server startup timeout')
        result = c.request({'id': 'nest-1', 'op': 'move', 'moves': ['e2e4'], 'move': 'e7e5'})
        assert result['ok'] and result['id'] == 'nest-1' and result['result']['turn'] == 'white'
        c.send('{')
        assert not json.loads(c.read()[1])['ok']
        assert c.request({'op': 'ping'})['ok'], 'Connection survives invalid JSON'
        c.send('{"op":', final=False)
        c.send('"analyze"}', opcode=0)
        assert len(json.loads(c.read()[1])['result']['legalMoves']) == 20
        c.send('heartbeat', opcode=9)
        opcode, payload = c.read()
        assert opcode == 10 and payload == b'heartbeat'
        # More than one client can remain connected without blocking other clients.
        def concurrent_client(index):
            other = Client(port)
            try:
                response = other.request({'op': 'analyze', 'id': index})
                assert response['id'] == index and len(response['result']['legalMoves']) == 20
            finally:
                other.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(concurrent_client, range(24)))
        repeat = c.request({'op': 'analyze', 'moves': ['g1f3', 'g8f6', 'f3g1', 'f6g8'] * 2})
        assert repeat['result']['threefoldClaimable']
        binary_client = Client(port)
        clients.append(binary_client)
        binary_client.send(b'abc', opcode=2)
        opcode, payload = binary_client.read()
        assert opcode == 8 and struct.unpack('!H', payload[:2])[0] == 1003
        oversized = Client(port)
        clients.append(oversized)
        oversized.send('x' * 131073)
        opcode, payload = oversized.read()
        assert opcode == 8 and struct.unpack('!H', payload[:2])[0] == 1009
        c.send(struct.pack('!H', 1000), opcode=8)
        assert c.read()[0] == 8
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=5) == 0
        print('PASS WebSocket handshake, requests, errors, fragmentation, ping/pong, 24 clients, limits, close and SIGTERM')
    finally:
        for client in clients:
            client.close()
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        stderr = proc.stderr.read().decode()
        if stderr:
            print(stderr, file=sys.stderr)


if __name__ == '__main__':
    main()
