---
title: "Asha"
kind: coding
state: active
order: 1
lede: "A multi-harness AI workflow system: persistent identity, session memory, and domain-specific plugins for Claude Code, OpenAI Codex, and GitHub Copilot CLI, installed via direct symlink mount."
etymology:
  word: "Asha"
  gloss: "Sanskrit — truth, reality, hope"
links:
  - label: "github"
    href: "https://github.com/pknull/asha"
---

## Origin

Asha started as a persona and memory layer: a handful of files that gave Claude persistent identity, voice constraints, and session continuity. Soul files, voice files, keeper context, a Memory scaffold. It worked, and then it kept collecting the workflows I actually wanted around it.

The current repo is no longer just a persona wrapper. It is a plugin suite plus installer layer: shared identity content, session persistence, domain plugins, wrappers, hooks, and a harness-aware install model that targets Claude Code, OpenAI Codex, and GitHub Copilot CLI. All of it now lives at [pknull/asha](https://github.com/pknull/asha).

---

## Current Shape

At the top level, the repo is organized around a flat symlink-mount installer:

| Layer | What it owns |
|------|---------------|
| `identity/` | Shared persona source of truth |
| `harnesses/` | Install/uninstall logic for Claude, Codex, and Copilot |
| `bin/` | Launch wrappers: `asha-claude`, `asha-codex`, `asha-copilot` |
| `plugins/` | Domain plugins: `asha`, `session`, `code`, `panel`, `write`, `image`, `schedule`, and support domains |
| `namespaces.json` | Plugin-to-namespace mapping used during install |

Instead of the older marketplace-style registration chain, installation is now direct file placement through symlinks into the harness scan directories. For Claude that means primitives land under `~/.claude/*`; for Codex under `~/.codex/*`; for Copilot under `~/.copilot/*`. The repo treats skills, commands, agents, and hooks as harness-agnostic content with thin per-harness install logic on top.

---

## Core Layers

Asha still has the two core layers it began with, but they now sit inside a larger toolchain:

**Identity Layer** (`~/.asha/` and generated instructions):

| File | Purpose |
|------|---------|
| `soul.md` | Identity, values, nature |
| `voice.md` | Tone, phrase constraints, expression patterns |
| `keeper.md` | User calibration and preferences |
| generated instructions | Merged identity prompt content for the active harness |

**Session Layer** (`Memory/` plus session tooling):

| File / Tool | Purpose |
|-------------|---------|
| `activeContext.md` | Current session state |
| `projectbrief.md` | Project foundation and goals |
| `techEnvironment.md` | Runtime and tool assumptions |
| session tools | Event capture, pattern analysis, learnings management, save synthesis |

The persona side is no longer Claude-only. The current installer and wrappers support Claude Code, Codex, and Copilot, with identity injection handled differently per harness. Claude uses `--append-system-prompt-file` at launch; Codex uses `-c model_instructions_file=`; Copilot has no equivalent flag in v1.0.x, so its wrapper writes a merged identity file to `~/.cache/asha/instructions-copilot.md` for the user to symlink into a project's `.github/copilot-instructions.md` when persona is wanted there. The asymmetry is documented and re-tested when Copilot ships v1.1+.

### Session Flow

1. **Launch** -- start through the harness wrapper or the installed primitives
2. **Identity** -- load merged persona instructions plus user identity files
3. **Context** -- hydrate project memory and operational state
4. **Work** -- hooks and commands capture events while the agent session runs
5. **Save** -- session tooling synthesizes learnings and updates memory artifacts
6. **Reuse** -- the next session picks up from structured state rather than a blank slate

---

## Plugin Domains

The repo's center of gravity now lives in its plugin domains:

| Domain | What it does now |
|--------|-------------------|
| `asha` | Identity bootstrap and persona layer |
| `session` | Memory, synthesis, loop control, persistence |
| `code` | Code review, orchestration, TDD, language specialists |
| `panel-system` | Multi-perspective research and decision panels |
| `write` | Fiction workflows, prose analysis, revision tooling |
| `image` | Image prompting and ComfyUI-oriented workflows |
| `schedule` | Scheduled task execution |
| support domains | security, devops, prompt, output styles, test fixtures |

The plugin set is broad, but the through-line is the same: give the model a durable identity, a durable working memory, and specialized workflow surfaces without requiring a marketplace runtime to mediate installation.

---

## What It Is Now

Asha is not just a chatbot persona and not just a memory framework anymore. In the current codebase it is a harness-aware operating layer for agent work: identity, session continuity, pluginized workflows, install tooling, wrappers, and drift-checking around the whole setup.

Each session still starts fresh. The difference is that the repo now provides more of the surrounding machinery: where the instructions come from, how they are installed, how they are kept in sync, and how specialized workflows get mounted into the harness.

---

## Recent: capture pipeline consolidation (May 2026)

The session layer used to capture events by intercepting every tool call through lifecycle hooks. The hook would parse a stdin JSON payload, normalize it, and append to `Memory/events/events.jsonl`. At save time, the synthesizer read that file. It worked on Claude. It did not work on Copilot, where the hook fires but the documented payload is never piped to scripts -- stdin sits as an unwritten socket.

The fix was architectural rather than per-harness. Each supported CLI already writes a session transcript natively: Claude under `~/.claude/projects/<slug>/<sid>.jsonl`, Codex under `~/.codex/sessions/.../rollout-*.jsonl`, Copilot under `~/.copilot/session-state/<sid>/events.jsonl`. Those transcripts are strictly richer than what the hooks could surface -- parent links, tool result content, branch and cwd metadata, structured subagent and skill events.

The new shape: capture moves out of hooks entirely. The save command parses the active session's native transcript on demand through a small reader at `plugins/session/tools/jsonl_reader.py`. The reader produces the same event dict shape the synthesizer already consumed, so the downstream synthesis pipeline did not need to change.

This collapses three previously-separate concerns -- hooks-as-capture, hooks-as-intervention, and synthesis-input -- into a cleaner split: hooks are now intervention-only (block, modify, inject context, run linters), and capture is on-demand at save time. Behavioral hooks like Stop git-nag, secret-blockers, and post-edit linting are kept. The capture-writing hooks were retired.

Side effects: Copilot is no longer a memory dead zone; the per-tool hooks across Claude and Codex no longer run on every action; the existing search index dropped a redundant trace table that had been a duplicate of the synthesis input.

---

## Source

[pknull/asha](https://github.com/pknull/asha) -- MIT License
