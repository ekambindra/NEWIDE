# AGENTS Instructions - Atlas Meridian

## Mandatory Continuity Read
Before any implementation, read continuity logs in this order:
1. `/Users/ekambindra/NEWIDE/chat1`
2. Highest existing `chatN` file (if `chat2+` exists)

Do not continue coding until this read is complete.

## Continuity Write Rule
When session context nears limit, write the next continuity file (`chat2`, `chat3`, ...), including:
1. completed changes,
2. verification status,
3. progress numbers and percentage,
4. next implementation tasks.

## Project Identity
- Name: Atlas Meridian
- Stack: Electron + TypeScript + React + Node.js backend modules
- Goal: Deterministic enterprise AI IDE with policy controls, checkpoints, replay, and benchmark proof.
