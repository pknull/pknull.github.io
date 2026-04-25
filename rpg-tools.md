# RPG dice tools

Three small Python libraries that came out of building chat bots for tabletop games.

**rpg-dice** rolls dice. The standard expression syntax — `2d6+3`, exploding sixes, drop-lowest, keep-highest — plus a handful of less common modes I wanted for specific systems. Pure stdlib, no dependencies, easy to drop into anything.

**rpg-flip** is the chance-and-coin layer: weighted random selections, multi-tier pulls, the structure you want when "roll a random monster" needs to feel like a monster manual rather than `random.choice`. Useful for procedural content beyond TTRPGs.

**rpg-card** randomizes card-driven systems — tarot, oracle decks, system-specific draw tables. Same shape as the others: small, focused, stays out of your way.

The three together cover most of the random-generation needs of a small RPG bot. Nothing here is clever; that's the point.
