import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { evaluateGuess, isValidGuess, resolveSecret } from "./engine.js";

function runWithGuesses(secret, guesses, maxAttempts) {
  output.write("Atlas Number Duel\n");
  output.write("Guess the secret number (1-20). You have 6 attempts.\n");

  for (let index = 0; index < Math.min(maxAttempts, guesses.length); index += 1) {
    const attempt = index + 1;
    const guess = Number(guesses[index]);

    if (!isValidGuess(guess)) {
      output.write(`Attempt ${attempt}/${maxAttempts} > Invalid input. Enter an integer from 1 to 20.\n`);
      continue;
    }

    const result = evaluateGuess(secret, guess);
    if (result === "correct") {
      output.write(`Attempt ${attempt}/${maxAttempts} > Correct. You won in ${attempt} attempt(s).\n`);
      return;
    }

    output.write(`Attempt ${attempt}/${maxAttempts} > ${result === "low" ? "Too low." : "Too high."}\n`);
  }

  output.write(`Game over. The secret number was ${secret}.\n`);
}

async function main() {
  const secret = resolveSecret();
  const maxAttempts = 6;
  const simulatedGuesses = process.env.ATLAS_GAME_GUESSES
    ? process.env.ATLAS_GAME_GUESSES.split(",").map((item) => item.trim()).filter(Boolean)
    : null;

  if (simulatedGuesses && simulatedGuesses.length > 0) {
    runWithGuesses(secret, simulatedGuesses, maxAttempts);
    return;
  }

  const rl = createInterface({ input, output });

  output.write("Atlas Number Duel\n");
  output.write("Guess the secret number (1-20). You have 6 attempts.\n");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const answer = await rl.question(`Attempt ${attempt}/${maxAttempts} > `);
    const guess = Number(answer.trim());

    if (!isValidGuess(guess)) {
      output.write("Invalid input. Enter an integer from 1 to 20.\n");
      continue;
    }

    const result = evaluateGuess(secret, guess);
    if (result === "correct") {
      output.write(`Correct. You won in ${attempt} attempt(s).\n`);
      rl.close();
      return;
    }

    output.write(result === "low" ? "Too low.\n" : "Too high.\n");
  }

  output.write(`Game over. The secret number was ${secret}.\n`);
  rl.close();
}

main().catch((error) => {
  output.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
