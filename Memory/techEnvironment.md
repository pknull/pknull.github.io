---
version: "1.0"
lastUpdated: "2025-12-05"
lifecycle: "execution"
stakeholder: "technical"
changeTrigger: "Created for journal project"
validatedBy: "ai"
dependencies: []
---

# techEnvironment

Technical documentation for the journal project (pknull.github.io).

## Quick Reference

**Location**: Eugene, OR | **Platform**: Linux | **Working Directory**: `/home/pknull/Code/journal`

## Project Stack

| Component | Technology |
|-----------|------------|
| Hosting | GitHub Pages |
| Build | Static HTML/CSS/JS |
| Version Control | Git |
| Framework | Asha (submodule at `./asha/`) |

## Core Standards

All technical work adheres to:

- **Security-First**: No hardcoded secrets, validate inputs
- **Performance**: Fast page loads, minimal dependencies
- **Accessibility**: WCAG compliance, semantic HTML, prefers-reduced-motion support
- **Documentation**: Self-documenting code + explicit comments where needed
- **AI-Native**: Code should be friendly to AI context loading (clear structure, standardized headers)

## Project Structure

```
journal/
├── asha/              # Asha framework (submodule)
├── Memory/            # Project context files
├── AGENTS.md          # → asha/CORE.md
├── CLAUDE.md          # → asha/CORE.md
└── GEMINI.md          # → asha/CORE.md
```

## Deployment

GitHub Pages serves from main branch. Changes pushed to main are automatically deployed.
