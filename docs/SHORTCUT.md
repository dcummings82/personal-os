# "Jot it" iPhone Shortcut

Saves a capture to Personal OS in a few seconds without opening the app. You pick a type (Inbox, Action, Work, Project, Idea or Responsibility), type or dictate the title, and it's saved. Add details at the end of what you type (see [Quick details](#quick-details)).

## 1. Get your capture key

In Personal OS: **More › iPhone Shortcut key › New key**, then **Copy key**. The key is shown once. It can only add items, never read them. Making a new key turns the old one off.

## 2. Build the Shortcut

Open the **Shortcuts** app, tap **+**, and name the shortcut **Jot it**. Add each action by typing its name in the search bar at the bottom. Shortcuts often pre-fills a new action's first box with the previous action's output, so clear a box before typing into it.

1. **List.** Add six items: `Inbox`, `Action`, `Work`, `Project`, `Idea`, `Responsibility`.
2. **Choose from List.** Tap the **›** arrow to show the prompt, and set it to `Save as`.
3. **Ask for Input.** Input type: Text. Put `What do you want to capture?` in **Prompt** and leave **Default Answer** empty.
4. **Get Contents of URL.**
   - URL: `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/capture` (your Project URL followed by `/rest/v1/rpc/capture`)
   - Tap **Show More**. Method: **POST**.
   - Headers: add `apikey` with your **anon / publishable key** as the value, and `Content-Type` with the value `application/json`.
   - Request Body: **JSON**, with three Text fields:
     - `p_key`: paste your capture key
     - `p_title`: choose the **Provided Input** variable
     - `p_type`: choose the **Chosen Item** variable (on some iPhones it's called **Selected Item**)
5. **Show Notification.** Set the text to the **Contents of URL** variable. It will say "Saved to Inbox", for example.

### Adding Work to a Shortcut you already have

Open **Jot it**, tap the **List** action, add an item, and type `Work`. Nothing else changes.

## Quick details

Words at the end of a capture fill in details, and are removed from the title. They work in the Shortcut and in the app's capture box.

| Type at the end | What it does | Example |
| --- | --- | --- |
| `today`, `tomorrow` (or `tmrw`) | Due date | `Pay rent tomorrow` |
| A weekday: `fri`, `friday`, `tues` | Due on the next one (today if it's that day) | `Call dentist fri` |
| A date: `11/14` or `11/14/27` | Due on that date | `Renew tags 12/1` |
| `!` or `!high`, `!critical`, `!low`, `!someday` | Priority | `Fix gutter !high` |
| `#home`, `#health`, `#finance`, `#family`, `#projects`, `#work` | Area | `Flu shot #health` |

Combine them in any order: `Call dentist fri !high #health` saves "Call dentist", due Friday, High priority, Health area. Only the last words count, so "Check friday deadline with team" keeps its title. Choosing **Work** in the Shortcut saves an Action in the Work area.

## 3. Make it quick to reach

- **Siri:** say "Hey Siri, Jot it".
- **Action button** (iPhone 15 Pro and later): Settings › Action Button › Shortcut › Jot it.
- **Lock Screen:** long-press the Lock Screen › Customize › add the Shortcuts widget.
- **Back Tap:** Settings › Accessibility › Touch › Back Tap › Double Tap › Jot it.

## Troubleshooting

- **"Invalid capture key":** make a new key in the app and paste it into `p_key` again.
- **401 or "No API key found":** check the `apikey` header has your anon / publishable key.
- **400 Bad Request:** usually the capture key doesn't match. Make a new key and paste it again.
- **An extra text box appears first:** delete any action above **List** (for example a "Create note" action added when the shortcut was started from Notes).
- **No internet:** the Shortcut shows an error instead of saving. Nothing is saved silently, so try again when you're back online.
