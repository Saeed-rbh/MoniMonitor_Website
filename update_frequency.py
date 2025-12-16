import json
import os

file_path = r'c:\Users\Saeed\Personal_Files\CodeDevelope\MoniMonitor_Website\src\services\mockTransactions.json'

try:
    with open(file_path, 'r') as f:
        transactions = json.load(f)

    monthly_keywords = ['Rogers', 'Bell', 'Netflix', 'Spotify', 'Rent', 'Mortgage', 'Insurance', 'GoodLife', 'WealthSimple Auto-Invest']
    daily_keywords = ['Starbucks', 'Tim Hortons', 'Subway', 'McDonalds', 'Uber', 'Lyft', 'Coffee']

    updated_count = 0
    for t in transactions:
        frequency = 'OneTime'
        reason = t.get('Reason', '')
        category = t.get('Category', '')

        # Check Monthly
        if any(k in reason for k in monthly_keywords):
            frequency = 'Monthly'
        # Check Daily
        elif any(k in reason for k in daily_keywords):
            frequency = 'Daily'
        
        # Specific overrides
        if category == 'Save&Invest' and 'WealthSimple' in reason:
             frequency = 'Monthly'

        if t.get('Frequency') != frequency:
            t['Frequency'] = frequency
            updated_count += 1

    with open(file_path, 'w') as f:
        json.dump(transactions, f, indent=2)

    print(f"Successfully updated {updated_count} transactions.")

except Exception as e:
    print(f"Error: {e}")
