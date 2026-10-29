# "Jot it" iPhone Shortcut

Saves a capture to Personal OS in a few seconds without opening the app. You pick a type (Inbox, Action, Project, Idea or Responsibility), type or dictate the title, and it's saved.

## 1. Get your capture key

In Personal OS: **More › iPhone Shortcut key › New key**, then **Copy key**. The key is shown once. It can only add items, never read them. Making a new key turns the old one off.

## 2. Build the Shortcut

Open the **Shortcuts** app, tap **+**, and name the shortcut **Jot it**. Add these actions in order:

1. **List.** Add five items: `Inbox`, `Action`, `Project`, `Idea`, `Responsibility`.
2. **Choose from List.** Set the prompt to `Save as`.
3. **Ask for Input.** Input type: Text. Prompt: `What do you want to capture?`
4. **Get Contents of URL.**
   - URL: `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/capture` (your Project URL followed by `/rest/v1/rpc/capture`)
   - Tap **Show More**. Method: **POST**.
   - Headers: add `apikey` with your **anon / publishable key** as the value, and `Content-Type` with the value `application/json`.
   - Request Body: **JSON**, with three Text fields:
     - `p_key`: paste your capture key
     - `p_title`: choose the **Provided Input** variable
     - `p_type`: choose the **Chosen Item** variable
5. **Show Notification.** Set the text to the **Contents of URL** variable. It will say "Saved to Inbox", for example.

## 3. Make it quick to reach

- **Siri:** say "Hey Siri, Jot it".
- **Action button** (iPhone 15 Pro and later): Settings › Action Button › Shortcut › Jot it.
- **Lock Screen:** long-press the Lock Screen › Customize › add the Shortcuts widget.
- **Back Tap:** Settings › Accessibility › Touch › Back Tap › Double Tap › Jot it.

## Troubleshooting

- **"Invalid capture key":** make a new key in the app and paste it into `p_key` again.
- **401 or "No API key found":** check the `apikey` header has your anon / publishable key.
- **No internet:** the Shortcut shows an error instead of saving. Nothing is saved silently, so try again when you're back online.
