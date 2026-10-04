"""Independent uptime probe. No financial data or credentials are logged."""
import json
import os
import time
import urllib.request


def probe():
    for endpoint in ('health', 'ready'):
        with urllib.request.urlopen('https://monimonitor.saeedarabha.com/api/' + endpoint, timeout=20) as response:
            if response.status != 200 or json.load(response).get('status') != 'ok':
                raise RuntimeError('Service unavailable')


def previous_failed():
    repository = os.environ.get('GITHUB_REPOSITORY', 'Saeed-rbh/MoniMonitor_Website')
    request = urllib.request.Request('https://api.github.com/repos/' + repository + '/actions/workflows/uptime.yml/runs?per_page=10', headers={'User-Agent': 'MoniMonitor-uptime'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            runs = json.load(response)['workflow_runs']
        previous = next((run for run in runs if str(run['id']) != os.environ.get('GITHUB_RUN_ID') and run['status'] == 'completed'), None)
        return previous is not None and previous['conclusion'] == 'failure'
    except Exception:
        return False


def main():
    for attempt in range(3):
        try:
            probe()
            print('Independent uptime and readiness checks passed.')
            return
        except Exception:
            if attempt < 2:
                time.sleep(10)
    token, chat = os.environ.get('MONITOR_BOT_TOKEN'), os.environ.get('MONITOR_CHAT_ID')
    if token and chat and not previous_failed():
        body = json.dumps({'chat_id': chat, 'text': 'MoniMonitor is unavailable or an ingestion worker is unhealthy after three independent checks. Check the protected diagnostics dashboard and service supervisor.'}).encode()
        try:
            request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=body, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=15) as response:
                if not json.load(response).get('ok'):
                    raise RuntimeError('Notification rejected')
        except Exception:
            print('Uptime notification could not be delivered. Inspect the repository monitor secrets.')
    raise SystemExit('Independent uptime check failed.')


if __name__ == '__main__':
    main()
