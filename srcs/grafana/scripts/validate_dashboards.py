#!/usr/bin/env python3
"""Offline provisioning and WebSocket metric contract checks (standard library only)."""

import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO_SRCS = ROOT.parent
ERRORS = []


def check(condition, message):
    if not condition:
        ERRORS.append(message)


def yaml_scalars(path, key):
    """Read simple scalar declarations from the checked-in provisioning YAML."""
    return re.findall(rf'^\s*{key}:\s*[\'\"]?([^\s\'\"#]+)', path.read_text(), re.M)


def load_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as error:
        ERRORS.append(f'{path.name}: {error}')
        return {}


def main():
    dashboards = ROOT / 'provisioning/dashboards'
    provider_paths = yaml_scalars(dashboards / 'dashboard.yml', 'path')
    check('/etc/grafana/provisioning/dashboards' in provider_paths,
          'Provider must discover the deployed dashboard directory')
    check('COPY provisioning /etc/grafana/provisioning' in (ROOT / 'Dockerfile').read_text(),
          'Grafana image must include provisioning files')
    datasource_uids = set()
    for path in (ROOT / 'provisioning/datasources').glob('*.y*ml'):
        datasource_uids.update(yaml_scalars(path, 'uid'))
    check('prometheus' in datasource_uids, 'Missing provisioned prometheus datasource UID')

    loaded = {path.name: load_json(path) for path in sorted(dashboards.glob('*.json'))}
    check('websocket.json' in loaded, 'Missing WebSocket dashboard')
    dashboard_uids = set()
    for name, dashboard in loaded.items():
        uid = dashboard.get('uid')
        check(isinstance(uid, str) and bool(uid), f'{name}: dashboard UID required')
        check(uid not in dashboard_uids, f'{name}: duplicate dashboard UID {uid}')
        dashboard_uids.add(uid)
        schema = dashboard.get('schemaVersion')
        check(type(schema) is int and schema > 0, f'{name}: invalid schemaVersion')
        check(bool(dashboard.get('title')), f'{name}: title required')
        check(isinstance(dashboard.get('panels'), list), f'{name}: panels must be an array')
        ids = set()
        for panel in dashboard.get('panels', []):
            panel_id = panel.get('id')
            context = f'{name} panel {panel_id}'
            check(type(panel_id) is int and panel_id > 0, f'{context}: invalid panel ID')
            check(panel_id not in ids, f'{context}: duplicate panel ID')
            ids.add(panel_id)
            position = panel.get('gridPos', {})
            check(all(type(position.get(k)) is int for k in ('x', 'y', 'w', 'h')),
                  f'{context}: gridPos requires integer x/y/w/h')
            if all(type(position.get(k)) is int for k in ('x', 'y', 'w', 'h')):
                check(0 <= position['x'] < 24 and position['y'] >= 0 and
                      0 < position['w'] <= 24 - position['x'] and position['h'] > 0,
                      f'{context}: panel outside Grafana grid')
            if panel.get('type') == 'text':
                continue
            datasource = panel.get('datasource', {})
            check(datasource.get('uid') in datasource_uids, f'{context}: unknown datasource')
            refs = [t.get('refId') for t in panel.get('targets', [])]
            check(bool(refs) and all(refs) and len(refs) == len(set(refs)),
                  f'{context}: target refIds must be present and unique')
            check(all(t.get('expr', '').strip() for t in panel.get('targets', [])),
                  f'{context}: empty PromQL expression')

    dashboard = loaded.get('websocket.json', {})
    gateway = (REPO_SRCS / 'nestJS/42chess/src/realtime/realtime.gateway.ts').read_text()
    registered = set(re.findall(r"name: '(websocket_connections_\w+)'", gateway))
    pattern = re.compile(
        r'sum\((?:(websocket_connections_active|websocket_connections_opened_total|'
        r'websocket_connections_closed_total)\{job="nestjs"\}|'
        r'rate\((websocket_connections_opened_total|websocket_connections_closed_total)'
        r'\{job="nestjs"\}\[\$__rate_interval\]\))\)')
    covered = set()
    for panel in dashboard.get('panels', []):
        if panel.get('type') == 'text':
            continue
        context = f'websocket.json panel {panel.get("id")}'
        check(panel.get('datasource') == {'type': 'prometheus', 'uid': 'prometheus'},
              f'{context}: must use the provisioned Prometheus datasource')
        check(bool(panel.get('description')), f'{context}: metric meaning required')
        check(panel.get('fieldConfig', {}).get('defaults', {}).get('noValue') == 'No data',
              f'{context}: absent metrics must not display as zero')
        for target in panel.get('targets', []):
            expr = target.get('expr', '')
            if expr == 'min(up{job="nestjs"})':
                continue
            match = pattern.fullmatch(expr)
            check(bool(match), f'{context}: unsupported WebSocket PromQL: {expr}')
            if match:
                metric = match.group(1) or match.group(2)
                check(metric in registered, f'{context}: metric not registered in gateway: {metric}')
                covered.add(('rate' if match.group(2) else 'value', metric))
                expected_unit = 'cps' if match.group(2) else 'short'
                check(panel.get('fieldConfig', {}).get('defaults', {}).get('unit') == expected_unit,
                      f'{context}: incorrect unit for {metric}')
    for metric in ('active', 'opened_total', 'closed_total'):
        check(('value', f'websocket_connections_{metric}') in covered,
              f'Missing value panel for websocket_connections_{metric}')
    for metric in ('opened_total', 'closed_total'):
        check(('rate', f'websocket_connections_{metric}') in covered,
              f'Missing rate panel for websocket_connections_{metric}')
    matchmaking = loaded.get('matchmaking.json', {})
    check(bool(matchmaking), 'Missing matchmaking dashboard')
    expected = {
        'max(matchmaking_queue_size{job="nestjs"})': 'short',
        'max(matchmaking_wait_seconds_count{job="nestjs"})': 'short',
        'histogram_quantile(0.5, max by (le) (matchmaking_wait_seconds_bucket{job="nestjs"}))': 's',
        'histogram_quantile(0.95, max by (le) (matchmaking_wait_seconds_bucket{job="nestjs"}))': 's',
        'max(matchmaking_wait_seconds_sum{job="nestjs"}) / max(matchmaking_wait_seconds_count{job="nestjs"})': 's',
        'max(games_finished{job="nestjs"})': 'short',
        'max by (outcome) (puzzle_attempts{job="nestjs"})': 'short',
        'min(up{job="nestjs"})': 'short',
    }
    found = set()
    for panel in matchmaking.get('panels', []):
        if panel.get('type') == 'text':
            continue
        defaults = panel.get('fieldConfig', {}).get('defaults', {})
        check(defaults.get('noValue') == 'No data', 'Matchmaking missing data must remain unknown')
        for target in panel.get('targets', []):
            expr = target.get('expr', '')
            check(expr in expected, f'Unexpected inventory PromQL: {expr}')
            check(defaults.get('unit') == expected.get(expr), f'Inventory unit mismatch: {expr}')
            found.add(expr)
    check(found == set(expected), 'Incomplete matchmaking inventory dashboard')
    if ERRORS:
        print('\n'.join(ERRORS), file=sys.stderr)
        return 1
    print(f'Validated {len(loaded)} dashboards: provisioning, unique IDs, grid, datasource, '
          'WebSocket metric registrations, inventory PromQL contracts and units.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
