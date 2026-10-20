# Pristine Laundry Care

Order and reports system for Pristine Laundry Care (Prishtinë).
Internal use only: this is **not** a fiscal register and issues no fiscal receipts.

Stack: React + Vite + TypeScript + Tailwind, Supabase (Postgres, Auth, row-level security).

## Folders

| Path | What it is |
| --- | --- |
| `src/` | The web app (runs in the browser) |
| `sql/` | Database changes, run by hand in the Supabase SQL editor, in number order |
| `supabase/functions/pin-login/` | Server function for worker PIN sign-in |
| `data/plu-prices.csv` | The shop's price list (source for `sql/002_price_list.sql`) |
| `scripts/csv-to-sql.py` | Rebuilds `sql/002_price_list.sql` from the CSV |

## Setup (one time)

### 1. Database
In Supabase: **SQL Editor → New query**, paste and run, in this order:
1. `sql/001_phase1_schema.sql`
2. `sql/002_price_list.sql`

### 2. Owner sign-in by email code
1. **Authentication → Sign In / Providers → Email**: Email enabled.
2. **Authentication → Emails → Magic Link** template: make sure the body contains `{{ .Token }}`
   (that is the 6-digit code). For example: `<p>Kodi juaj: <strong>{{ .Token }}</strong></p>`.
3. Supabase's built-in email sends only a few emails per hour. That is enough for two owners;
   if it becomes a problem, add your own SMTP under **Authentication → Emails → SMTP**.

### 3. Worker PIN function
**Edge Functions → Deploy a new function → Via Editor**, name it `pin-login`,
paste `supabase/functions/pin-login/index.ts`, deploy.
Then open the function's **Details** and turn **Verify JWT** off
(the function does its own checks; workers are not signed in yet when they call it).

### 4. People
For each person: **Authentication → Users → Add user → Create new user**,
with **Auto Confirm User** ticked.
- Owners: their real email; any long random password (they will never use it).
- Workers: a made-up email such as `arben@punetor.pristine`; any long random password.

Then in the SQL editor:

```sql
select public.setup_user('owner@email.com', 'Emri Mbiemri', 'admin');
select public.setup_user('arben@punetor.pristine', 'Arben', 'worker', '1234');  -- PIN: 4-6 digits
```

Running `setup_user` again for the same email changes the name / PIN.

### 5. Run the app
```bash
cp .env.example .env.local   # fill in URL + anon key from Settings -> API
npm install
npm run dev
```

## Checks
```bash
npm run build   # type check + production build
```
