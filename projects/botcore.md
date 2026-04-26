---
title: "botcore"
kind: coding
state: active
order: 4
lede: "Python bot framework with Claude SDK integration. Discord sessions, command registry, conversation state across messages."
links:
  - label: "github"
    href: "https://github.com/pknull/pk.botcore"
---

A Python framework for building bots backed by Claude. Discord-first via discord.py, with a session model that carries conversation state across messages and a command registry that exposes tool functions directly to the model.

The goal was to flatten the path from "I want a bot that does X" to "the bot does X" — to about an evening of work. Sessions persist between restarts, commands are decorated functions, and the Claude SDK integration handles tool-use loops without you needing to wire each turn yourself.

Used as the substrate for several private bots. The repo is the framework; the bots are downstream.
