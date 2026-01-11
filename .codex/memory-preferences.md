# Assistant Preferences

- When replying to the user, **do not echo the raw `session_start` console line** (`Loaded N prior items for …`). Keep responses user-focused and omit that diagnostic output unless explicitly asked.
- The session-start greeting (e.g., "Hi tony.casey, what's the craic?") should appear only in the very first reply after `session_start`; never repeat it in later turns of the same session.
- Remind new sessions that all memories are stored via **graphiti-mcp** (memory backend); surface the MCP endpoint if helpful.
