# No Browser Subagent — Use Edge Instead

**NEVER** use the `browser_subagent` tool for visual verification.
The browser automation layer (CDP connection to Chrome) is non-functional in this environment and will cause the agent to hang indefinitely with no way to cancel.

Instead of using `browser_subagent`, use one of these alternatives:

1. **Open in Edge via command line** (preferred for quick visual checks):
   ```
   Start-Process "msedge" -ArgumentList "<url_or_file_path>"
   ```
   Then ask the user to confirm what they see.

2. **Read source files directly** if you need to verify HTML structure.

3. **Ask the user** to open the app and report back what they see.
