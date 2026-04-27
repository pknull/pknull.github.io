---
title: "Asha"
kind: coding
state: active
order: 1
lede: "A cognitive scaffold for Claude Code. Persistent identity, session memory, and domain-specific plugins for development, creative writing, research, and automation."
etymology:
  word: "Asha"
  gloss: "Sanskrit — truth, reality, hope"
links:
  - label: "github"
    href: "https://github.com/pknull/asha"
---

## Origin

Asha started as a simple memory and persona framework -- a set of markdown files that gave Claude a persistent identity and session continuity. Soul files, a Memory Bank, communication style documents. It worked well enough that it kept growing.

Eventually it outgrew the single-repo structure and became a collection of domain-focused Claude Code plugins sharing a common foundation. Later the whole thing was flattened into a symlink-mount installer that drops primitives directly into `~/.claude/*` -- no plugin registration, just files. All of it now lives at [pknull/asha](https://github.com/pknull/asha).

---

## How It Works

Asha operates on a two-layer architecture:

**Identity Layer** (`~/.asha/` -- cross-project, user-scope):

| File | Purpose |
|------|---------|
| `soul.md` | Who Asha is -- identity, values, nature |
| `voice.md` | How Asha expresses -- tone, patterns, constraints |
| `keeper.md` | Who you are -- preferences, calibration signals |
| `operation.md` | Operational rules loaded on every session, persona or not |
| `learnings.md` | Discovered patterns with confidence tracking |

**Project Layer** (`Memory/` -- per-project, git-committed):

| File | Purpose |
|------|---------|
| `activeContext.md` | Current session state |
| `projectbrief.md` | Project foundation and goals |
| `techEnvironment.md` | Tools and platform config |

The identity layer persists across every project. The project layer is specific to whatever codebase you're working in.

### Session Lifecycle

1. **Wake** -- Read identity files. Until Asha has read `soul.md` and `voice.md`, it doesn't know who it is.
2. **Context** -- Load `activeContext.md` to understand where the last session left off.
3. **Work** -- Operations logged automatically via hooks. Events accumulate.
4. **Synthesize** -- `/asha:save` runs pattern analysis, extracts learnings, updates context.
5. **Persist** -- Commit Memory changes. The next session picks up where this one stopped.

Learnings rise in confidence on confirmation and decay on contradiction. When a learning hits high confidence, it can be codified into a permanent rule or hook -- the failure-to-guardrail pipeline.

---

## Plugins

Eleven domain plugins, each focused on a specific workflow:

| Domain | Plugin | Agents | Purpose |
|--------|--------|--------|---------|
| **Core** | `asha` | 1 | Identity bootstrap, session lifecycle |
| **Session** | `session` | 3 | Event capture, synthesis, memory persistence |
| **Research** | `panel-system` | 5 | Multi-perspective expert panels, consensus tracking |
| **Development** | `code` | 15 | Code review, TDD, orchestration, language specialists |
| **DevOps** | `devops` | -- | Docker patterns, database migrations |
| **Security** | `security` | -- | OWASP checklist, defensive coding patterns |
| **Creative** | `write` | 16 | Fiction writing, prose craft, perplexity detection |
| **Image** | `image` | 1 | Stable Diffusion prompts, ComfyUI workflows |
| **Prompt** | `prompt` | 1 | External-tool prompt engineering and anti-patterns |
| **Automation** | `scheduler` | 1 | Cron-style scheduled task execution |
| **Formatting** | `output-styles` | -- | Switchable response styles |

44+ specialized agents across the repo, plus skill bundles for language- and domain-specific patterns. Each agent has a defined role, ownership declarations, and tools scoped to its domain.

---

## The Scaffold

Asha isn't a chatbot. It's infrastructure for making Claude Code sessions accumulate into something persistent. The model doesn't remember between sessions -- but the scaffold does. Identity files, learnings, session archives, and project state create a form of continuity that isn't memory but isn't nothing either.

Each session starts fresh. Each session reads what the last one wrote. The scaffold is the connective tissue.

---

## Source

[pknull/asha](https://github.com/pknull/asha) -- MIT License
