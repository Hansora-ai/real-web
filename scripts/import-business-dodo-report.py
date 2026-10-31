#!/usr/bin/env python3
"""Create idempotent reconciliation SQL from a Dodo Payments CSV. No PII is retained.
Usage: python3 scripts/import-business-dodo-report.py /private/payments-report.csv > /private/import.sql
Review and execute with the service/admin database connection. Does not grant credits or modify payments.
"""
import csv, hashlib, sys
from decimal import Decimal
from pathlib import Path
p = Path(sys.argv[1])
source_hash = hashlib.sha256(p.read_bytes()).hexdigest()
records = {}
for r in csv.DictReader(p.open(encoding='utf-8-sig', newline='')):
    if r['Payment Status'] != 'succeeded':
        continue
    payment_id = r['Payment ID']
    if not payment_id.startswith('pay_') or not payment_id.replace('_', '').isalnum():
        raise ValueError('Invalid payment ID')
    currency = r['Settlement Currency']
    if len(currency) != 3 or not currency.isalpha() or not currency.isupper():
        raise ValueError('Invalid settlement currency')
    gross = Decimal(r['USD Equivalent Amount']) * 100
    amount, tax = Decimal(r['Settlement Amount']), Decimal(r['Settlement Tax']) if r['Settlement Tax'] else None
    if not gross.is_finite() or gross != gross.to_integral() or gross < 0 or not amount.is_finite() or (tax is not None and (not tax.is_finite() or not 0 <= tax <= amount)):
        raise ValueError('Invalid report amounts')
    row = (int(gross), amount, tax if tax is not None else 'NULL', currency)
    if payment_id in records and records[payment_id] != row:
        raise ValueError('Conflicting duplicate payment')
    records[payment_id] = row
print('begin;')
for payment_id, (gross, amount, tax, currency) in records.items():
    print(f"insert into public.business_payment_reconciliation(provider,transaction_id,gross_usd_cents,settlement_amount,settlement_tax,settlement_currency,source_sha256) select 'dodopayments','{payment_id}',{gross},{amount},{tax},'{currency}','{source_hash}' where exists(select 1 from public.payments where provider='dodopayments' and transaction_id='{payment_id}' and status='succeeded') on conflict(provider,transaction_id) do update set gross_usd_cents=excluded.gross_usd_cents,settlement_amount=excluded.settlement_amount,settlement_tax=excluded.settlement_tax,settlement_currency=excluded.settlement_currency,source_sha256=excluded.source_sha256,imported_at=now();")
print('commit;')
