"""Turns the shop's price list CSV into SQL: python3 scripts/csv-to-sql.py plu-prices.csv > sql/002_price_list.sql"""
import csv
import sys

def q(s):
    return "'" + s.replace("'", "''") + "'"

rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
print("-- Price list loaded from plu-prices.csv (%d rows). Safe to run twice." % len(rows))
print("insert into public.services (plu, name_on_list, item, category, service, line, price_eur, price_type) values")
vals = [
    "  (%d, %s, %s, %s, %s, %s, %s, %s)" % (
        int(r["plu"]), q(r["name_on_list"]), q(r["item"]), q(r["category"]),
        q(r["service"]), q(r["line"]), r["price_eur"], q(r["price_type"]))
    for r in rows
]
print(",\n".join(vals))
print("on conflict (plu) do nothing;")
