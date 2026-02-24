export function isValidGuess(value) {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

export function evaluateGuess(secret, guess) {
  if (!isValidGuess(secret) || !isValidGuess(guess)) {
    throw new Error("secret and guess must be integers between 1 and 20");
  }
  if (guess === secret) {
    return "correct";
  }
  return guess < secret ? "low" : "high";
}

export function resolveSecret(random = Math.random, forced = process.env.ATLAS_GAME_SECRET) {
  const forcedNumber = Number(forced);
  if (isValidGuess(forcedNumber)) {
    return forcedNumber;
  }
  return Math.floor(random() * 20) + 1;
}
