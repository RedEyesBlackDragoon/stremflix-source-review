# Privacy behavior

Household stores each profile's preferences, feedback, imported viewing events, and sanitized playback events on the configured private server.
The account binding contains a stable Stremio identifier. Household does not store Stremio passwords, vendor authentication cookies, playback URLs, or debrid keys.
Netflix import accepts the person's downloaded CSV. Household never signs into Netflix.
Netflix updates require another import. There is no real-time Netflix synchronization.

Raw CSV files are not retained after parsing. Normalized rows remain for matching review and batch removal.
Imported episode rows are interest signals; they do not mark a season complete.
Administrators can export a selected profile to JSON, remove an import batch, undo mappings, and delete a profile.
Server foreign keys cascade profile deletion through its associated private records.
Administrative audit events retain the action and deleted object ID, without titles or histories.
Local vendor session and cache removal across all devices is not yet complete and is a release blocker.
Backups retain deleted records until their retention period expires. Operators must state that period to their household.

The application does not enable remote analytics or send histories to an LLM.
Upstream optional Discord presence is disabled by default. Enabling it can disclose a title through Discord.
Metadata images load from their providers. Those providers can observe normal image requests and network addresses.
Crash diagnostics and logs must not include tokens, URLs with credentials, private histories, or raw CSV data.
The current worker emits generic failure status. API access logging is disabled in the provided launchers.
