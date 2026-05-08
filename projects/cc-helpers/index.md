---
title: "CC-Helpers"
kind: coding
state: active
order: 6
lede: "Two small tools for managing Claude Code sessions: a TUI session manager and a virtual-office visualizer."
etymology:
  word: "cc"
  gloss: "Claude Code, of course. The 'helpers' is doing a lot of work."
links:
  - label: "ccsessionctl"
    href: "https://github.com/pknull/ccsessionctl"
  - label: "ccworkspace"
    href: "https://github.com/pknull/ccworkspace"
---

Two small tools for working with Claude Code at the command line.

**ccsessionctl** is a TUI for managing active sessions. List them, switch between them, prune the dead ones, see at a glance which working directory each is anchored to. Rust + ratatui. Lives in the gap between `claude` and a tmux pane manager.

**ccworkspace** is the same problem viewed sideways: a desktop companion that visualizes your Claude Code, Codex CLI, and Clawdbot sessions as a virtual office. Agents sit at desks. Work-in-progress shows on their screens. It is partly a toy, partly a working surface, partly an experiment in whether spatial metaphors help me track concurrent work better than a flat list does. Built in Godot.
