"""Run against test-server.cjs and a frontend on localhost:4173 (Python Playwright)."""
import csv
import re
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect

API = 'http://127.0.0.1:4174'
FRONTEND = 'http://localhost:4173'
CREDENTIALS = {'username': 'browser-test', 'password': 'Synthetic-browser-test-123'}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        for mode, width, height in [('desktop', 1440, 1000), ('mobile', 390, 844)]:
            context = browser.new_context(viewport={'width': width, 'height': height})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            fixture = context.request.get(API + '/__browser_fixture')
            assert fixture.ok and fixture.json().get('isolatedBrowserFixture'), 'Refusing to test a non-fixture API'
            context.request.post(API + '/register', data=CREDENTIALS)
            login = context.request.post(API + '/login', data=CREDENTIALS)
            assert login.ok, login.text()
            headers = {'Authorization': 'Bearer ' + login.json()['accessToken']}
            merchant = 'Browser merchant ' + uuid.uuid4().hex[:8]
            edge_reason = '=SUM(1,2) "quoted"\nsecond line ' + uuid.uuid4().hex[:8]
            for reason, amount in [(merchant, 12.34), (edge_reason, 0.01)]:
                response = context.request.post(API + '/transactions', headers=headers, data={
                    'Amount': amount, 'Category': 'Expense', 'Label': 'Groceries',
                    'Reason': reason, 'Currency': 'CAD', 'Timestamp': datetime.now(ZoneInfo('America/Toronto')).strftime('%Y-%m-%dT12:00:00'),
                    'Account': 'Test cash',
                })
                assert response.status == 201, response.text()
            page.goto(FRONTEND)
            page.wait_for_load_state('networkidle')
            # Accessible names also regress the previously unassociated labels.
            page.get_by_label('Username', exact=True).fill(CREDENTIALS['username'])
            page.get_by_label('Password', exact=True).fill(CREDENTIALS['password'])
            page.get_by_role('button', name='Login', exact=True).click()
            page.get_by_role('button', name='Search transactions').click()
            page.get_by_placeholder('Merchant, bank or amount').fill(merchant)
            page.get_by_text(merchant, exact=True).click()
            page.get_by_role('button', name='Shopping', exact=True).click()
            with page.expect_response(lambda response: '/transactions/' in response.url and response.request.method == 'PUT') as saved:
                page.get_by_role('button', name='Save', exact=True).click()
            assert saved.value.ok, saved.value.text()
            page.get_by_role('button', name='Close dialog').click()
            page.reload()
            page.get_by_role('button', name='Search transactions').click()
            page.get_by_placeholder('Merchant, bank or amount').fill(merchant)
            page.get_by_text(merchant, exact=True).click()
            expect(page.locator('.TxDetail_CategorySection').get_by_role('button', name='Shopping', exact=True)).to_have_class(re.compile(r'\bactive\b'))
            records = context.request.get(API + '/transactions', headers=headers).json()
            edited = next(row for row in records if row['Reason'] == merchant)
            assert edited['Label'] == 'Shopping' and edited['AmountMinor'] == 1234
            page.get_by_role('button', name='Close dialog').click()
            page.get_by_text('Profile', exact=True).click()
            with page.expect_download() as download:
                page.get_by_text('Export CSV', exact=True).click()
            downloaded = download.value
            assert downloaded.suggested_filename.endswith('.csv')
            with open(downloaded.path(), encoding='utf-8-sig', newline='') as stream:
                exported = list(csv.DictReader(stream))
            exported_edit = next(row for row in exported if row['Reason'] == merchant)
            assert exported_edit['Label'] == 'Shopping'
            assert exported_edit['Amount'] == '12.34' and exported_edit['AmountMinor'] == '1234'
            assert exported_edit['Currency'] == 'CAD'
            escaped = next(row for row in exported if row['Reason'] == "'" + edge_reason)
            assert escaped['Amount'] == '0.01' and escaped['AmountMinor'] == '1'
            assert len(exported) == len(records)
            assert not errors, errors
            print(f'{mode}: labeled login, edit persistence, API values, populated CSV, exact cents, escaping, no JS errors PASS', flush=True)
            context.close()
    finally:
        browser.close()
