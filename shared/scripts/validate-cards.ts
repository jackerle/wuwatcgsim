// Checks every card set. Entries that are still empty stubs are reported as
// remaining work, not errors.
// Run with: npm run validate:cards
import { ALL_CARDS, ALL_SETS, cardsNeedingResolve, isUnfilled, validateSet } from "../src/cardDb";

let total = 0;

for (const [set, cards] of Object.entries(ALL_SETS)) {
  const issues = validateSet(cards);
  const unfilled = cards.filter(isUnfilled).length;
  const filled = cards.length - unfilled;
  total += issues.length;

  const progress = `${filled}/${cards.length} filled`;
  if (issues.length === 0) {
    console.log(`OK  ${set}: ${progress}`);
  } else {
    console.log(`ERR ${set}: ${progress}, ${issues.length} issue(s)`);
    for (const issue of issues) {
      console.log(`      ${issue.cardId}  ${issue.field}: ${issue.message}`);
    }
  }
}

const unfilled = ALL_CARDS.filter(isUnfilled).length;
console.log(`\n${ALL_CARDS.length - unfilled}/${ALL_CARDS.length} cards filled in.`);

const needResolve = cardsNeedingResolve();
if (needResolve.length > 0) {
  console.log(
    `${needResolve.length} filled card(s) still have effects with no resolve — playable, applied by hand.`
  );
}

if (total > 0) {
  console.error(`${total} issue(s) found.`);
  process.exit(1);
}
