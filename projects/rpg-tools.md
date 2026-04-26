---
title: "RPG dice tools"
kind: coding
state: inactive
order: 7
lede: "Three small Python libraries for tabletop RPG bots: dice expressions, weighted random selection, card draws."
etymology:
  word: "RPG"
  gloss: "role-playing game; the abbreviation crystallized around D&D in the mid-1970s"
links:
  - label: "rpg-dice"
    href: "https://github.com/pknull/rpg-dice"
  - label: "rpg-flip"
    href: "https://github.com/pknull/rpg-flip"
  - label: "rpg-card"
    href: "https://github.com/pknull/rpg-card"
---

Three small Python libraries that came out of building chat bots for tabletop games.

**rpg-dice** rolls dice. The standard expression syntax — `2d6+3`, exploding sixes, drop-lowest, keep-highest — plus a handful of less common modes I wanted for specific systems. Pure stdlib, no dependencies, easy to drop into anything.

**rpg-flip** is the chance-and-coin layer: weighted random selections, multi-tier pulls, the structure you want when "roll a random monster" needs to feel like a monster manual rather than `random.choice`. Useful for procedural content beyond TTRPGs.

**rpg-card** randomizes card-driven systems — tarot, oracle decks, system-specific draw tables. Same shape as the others: small, focused, stays out of your way.

The three together cover most of the random-generation needs of a small RPG bot. Nothing here is clever; that's the point.
