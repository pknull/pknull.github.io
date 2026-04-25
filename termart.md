# termart

Generative art that lives in your terminal. The first piece is a bonsai tree: it sprouts from a seed, branches according to noise functions tempered by a few horticultural rules, leafs out, and eventually drops its leaves. Each one is different.

Built in Rust on top of ratatui, so it runs anywhere you have an SSH session and a Unicode-capable font. No external runtime, no GPU, no dependencies you didn't already have.

I started it because I wanted a screensaver for tmux sessions. It became a small studio for figuring out how to make procedural growth feel intentional rather than random — which patterns trigger the eye to read "alive" and which read "noise."
