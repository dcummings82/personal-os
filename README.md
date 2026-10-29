# Personal OS

A personal command center for tasks, projects, recurring responsibilities, ideas and quick captures. It runs in the browser on a laptop and as a home-screen app on an iPhone, with data synced through Supabase.

- **App:** plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages.
- **Data:** Supabase (Postgres). Row-level security means only your signed-in account can read or change your rows.
- **Quick capture:** an iPhone Shortcut ("Jot it") that adds items with a capture key that can only add, never read.

## Build phases

| Phase | What it adds | Status |
| --- | --- | --- |
| 0 | Clickable mockup | Done |
| 1 | Login, PIN lock, capture, lists, edit panel with type picker, status buttons, recurring "Done this cycle", iPhone Shortcut | This release |
| 2 | Today's pad with carry-over, daily notes, Clear completed | Next |
| 3 | Full project pages with inline task editing and the activity log | Planned |
| 4 | Google Calendar both ways | Planned |

## One-time setup

### 1. Set up the database (Supabase)

1. In your Supabase project, open **SQL Editor › New query**.
2. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. It is safe to run again later.
3. Open **Authentication › Users › Add user › Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Open **Authentication › Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can make an account.

### 2. Connect the app to the database

Put your **Project URL** and **anon / publishable key** (Project Settings › API) into [`js/config.js`](js/config.js). Both are meant to be public. Never put the `service_role` or secret key there.

### 3. Turn on hosting (GitHub Pages)

In this repo on GitHub: **Settings › Pages › Build and deployment**. Set Source to **Deploy from a branch**, Branch to **main** and folder **/ (root)**, then **Save**. After a minute the app is live at `https://<your-username>.github.io/personal-os/`.

### 4. Put it on your iPhone

1. Open the app address in **Safari**.
2. Tap **Share › Add to Home Screen**.
3. Open it from the home screen, sign in, and choose a 4-digit PIN.

Do the same on each laptop's browser. Each device has its own PIN.

### 5. Add the "Jot it" Shortcut

Follow [docs/SHORTCUT.md](docs/SHORTCUT.md).

## How the PIN works

The PIN locks the app each time it opens and after 10 minutes in the background. Five wrong tries signs that device out. The PIN is stored on the device as a salted hash; your data itself is protected by the account login.
