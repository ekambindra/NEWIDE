# Chat Continuity Protocol

This repository uses rolling continuity logs to preserve implementation state across context resets.

## Required Startup Sequence For Every New Chat
1. Read `/Users/ekambindra/NEWIDE/chat1` first.
2. If files `chat2`, `chat3`, ... exist, read the highest-numbered one last.
3. Summarize current state from the latest `chatN` file before making edits.
4. Continue implementation only after this read/summarize step.

## When Context Is Near Limit
1. Write a new continuity file (`chat2`, then `chat3`, and so on).
2. Include:
   - work completed in that session,
   - verification commands/results,
   - progress counts (`completed/total`, `%`),
   - next tasks.

## File Naming
- Continuity files must be root-level and named: `chat1`, `chat2`, `chat3`, ...
