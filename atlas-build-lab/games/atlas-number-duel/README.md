# Atlas Number Duel

Small CLI game generated as a product-build test for Atlas Meridian.

## Rules
- Secret number is between 1 and 20.
- You get up to 6 guesses.
- The game hints `too low` or `too high` after each guess.

## Run
```bash
npm run start
```

For deterministic test play:
```bash
ATLAS_GAME_SECRET=12 npm run start
```

## Test
```bash
npm run test
```
