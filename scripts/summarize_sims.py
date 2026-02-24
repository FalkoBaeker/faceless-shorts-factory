#!/usr/bin/env python3
import json
from pathlib import Path

BASE = Path('/Users/falkobaeker/.openclaw/workspace/outputs')
REQUIRED = [
    'sim_api_flow.json',
    'sim_orchestration.json',
    'sim_http_flow.json',
    'sim_http_failure_flow.json',
    'sim_admin_publish.json',
    'sim_web_flow.json',
]


def load_json(path: Path):
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def main():
    missing = [name for name in REQUIRED if not (BASE / name).exists()]
    if missing:
        raise SystemExit(f'MISSING_SIM_OUTPUTS:{",".join(missing)}')

    api = load_json(BASE / 'sim_api_flow.json')
    orch = load_json(BASE / 'sim_orchestration.json')
    http_ok = load_json(BASE / 'sim_http_flow.json')
    http_fail = load_json(BASE / 'sim_http_failure_flow.json')
    admin = load_json(BASE / 'sim_admin_publish.json')
    web = load_json(BASE / 'sim_web_flow.json')

    summary = {
        'status': 'ok',
        'checks': {
            'api_final_status': api.get('finalStatus'),
            'api_timeline_length': api.get('timelineLength'),
            'orch_task_count': orch.get('taskCount'),
            'orch_segments': [s.get('sec') for s in orch.get('segments', [])],
            'http_success_status': http_ok.get('generatedStatus'),
            'http_success_ledger_types': http_ok.get('ledgerTypes'),
            'http_failure_status': http_fail.get('generatedStatus'),
            'http_failure_ledger_types': http_fail.get('ledgerTypes'),
            'publish_status': admin.get('publishedStatus'),
            'publish_job_status': admin.get('jobStatus'),
            'web_step_count': web.get('stepCount'),
            'web_variant': web.get('selectedVariant')
        },
        'pass': {
            'api_ready': api.get('finalStatus') == 'READY',
            'orch_master30_segments': [s.get('sec') for s in orch.get('segments', [])] == [12, 12, 8],
            'http_ready': http_ok.get('generatedStatus') == 'READY',
            'billing_commit_seen': (http_ok.get('ledgerTypes') or [])[-2:] == ['RESERVED', 'COMMITTED'],
            'failure_released': (http_fail.get('ledgerTypes') or [])[-2:] == ['RESERVED', 'RELEASED'],
            'publish_done': admin.get('publishedStatus') == 'PUBLISHED' and admin.get('jobStatus') == 'PUBLISHED',
            'web_model_ok': web.get('stepCount') == 8 and web.get('selectedVariant') == 'MASTER_30'
        }
    }

    summary['all_pass'] = all(summary['pass'].values())
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
