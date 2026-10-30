# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Developers who run several AI agent chats at once across projects and machines, and glance back to see what needs them. The app stays open for hours as a daily driver (desktop Electron, plus phone and browser clients). Also meant to look intentional to a stranger who installs it.

## Product Purpose
Yoake is the desktop/phone client for `yoakeland`, a self-hosted agent daemon. It holds chats, tools, terminal, editor, diffs and a browser in one window, and lets one person supervise many running agents. Success: the user knows at a glance what needs them, and can do real work in the conversation without leaving it.

## Positioning
*Inferred from SPEC.md, README.md and the sidebar tiers; not confirmed by the user.* Supervising a fleet of agents at a glance (Needs you / Working / Ready, lamps and rings), on your own server, from any device.

## Operating Context
Long sessions, dark rooms, many chats, frequent glances more than reading. Server connections over unix socket, TLS or WebRTC. Themes and an accent color are user-selectable; providers (Claude, Codex, DeepSeek, OpenRouter...) have brand colors.

## Capabilities and Constraints
SvelteKit static SPA in Electron; rem-based sizing scaled by a user UI-font-size setting; user themes (16 presets) recolor every token via `deriveTheme`; an "opaque / frosted" surface setting; custom, traffic-light and native window chrome; a mobile layout under a breakpoint.

## Brand Commitments
- Dark, calm, sparse: few visible controls, details one click deeper.
- Theme accent for everything, provider brand colors only for provider things.
- Flat controls; the only gradient is the lamp glow on the Effort and Mode sliders.
- Typefaces (Questrial, Departure Mono) are NOT binding; open to change.
- Comfort is binding, the current finish is not. The goal is more professional and production-ready, not a freeze of today's look. What "comfort" means exactly is still an open question to the user.

## Product Principles
1. Glanceable before readable: state is carried by shape, position and lamp, not sentences.
2. Calm by default: the page is quiet until something needs the user.
3. One accent, one grammar: every surface, control and state follows the same few rules, so themes recolor cleanly.
4. The work is the content: chrome recedes behind chat, code and diffs.
