---
name: Yoake
description: A calm, dark, hue-agnostic client for supervising many agent chats. One accent drives every color.
colors:
  accent: "#7c9bff"
  ground: "hsl(226 12% 6%)"
  panel: "hsl(226 10% 9%)"
  text: "hsl(226 10% 92%)"
  text-dim: "hsl(226 7% 72%)"
  edge: "hsla(226 20% 95% / 0.08)"
  danger: "#ff6b6b"
  success: "#58d68d"
  warning: "#f0b429"
  info: "#5b9bff"
typography:
  title:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.14rem"
    fontWeight: 600
  body:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.93rem"
    fontWeight: 400
  label:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 500
  heading:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.79rem"
    fontWeight: 600
rounded:
  xs: "4px"
  sm: "6px"
  lg: "10px"
  float: "14px"
  pill: "999px"
spacing:
  half: "4px"
  "1": "8px"
  "2": "16px"
  "3": "24px"
  "4": "32px"
  "5": "48px"
components:
  field:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sm}"
    height: "2rem"
  popover:
    rounded: "{rounded.lg}"
    backgroundColor: "{colors.panel}"
---

# Design System: Yoake

## Overview

**Creative North Star: "The Night Desk"**

A dim desk where the work is lit and everything else stays out of the way. Surfaces are a few quiet steps of one hue; the accent is the lamp. Nothing shouts until an agent needs you. This describes the system as built; the name is proposed and not yet confirmed.

The direction is "more professional and production-ready, comfort kept": this file records the system as built plus the rules it is being tightened toward, and is not a promise to preserve every current detail.

Color is never a fixed palette. The user picks one accent (a hue slider, one of 16 theme presets, or a color sampled from their wallpaper) and `deriveTheme` produces every surface, edge and text color from that hue. A preset may override ground, panel, text and accent. So every rule below is about roles and relationships, not hex values. The hexes in the frontmatter are the default accent's output.

**Key Characteristics:**
- Dark first, light supported; the same roles in both.
- Sparse: few visible controls, details one click deeper.
- Flat: depth by tone and hairline, shadow only on what floats.
- One accent for "on", "focused", "yours"; provider brand colors only on provider things.
- Light comes from state (lamps, rings, tiers), not from decoration.

## Colors

Low-saturation surfaces so the accent (often 60 to 90% saturation) is the only loud thing.

### Primary
- **Accent** (default `#7c9bff`, user-chosen): on-state, focus ring, selection, active tab, links, caret. Used on a small share of any screen.

### Neutral
- **Ground** (`hsl(h 12% 6%)`): the window behind panels.
- **Panel** (`hsl(h 10% 9%)`): the chat, sidebars, drawers.
- **Text** (`hsl(h 10% 92%)`) and **Text dim** (`hsl(h 7% 72%)`, 8.8:1 on panel): body and secondary.
- **Edge** (`hsla(h 20% 95% / 0.08)`): the one hairline. Same value on all four sides.
- **Washes** (`--wash-1..4`, 4/6/9/14% of text): rest, hover, active, strong edge. Always these four, never white or black literals.

### Semantic
Danger, success, warning, info are fixed signal colors, cooled together by Quiet Room, and deeper on the light scheme so they hold up as text. Red is for failure and for destructive intent (hover); a warning that's standing state stays quiet: plain dim text.

### Named Rules
**The One Hue Rule.** Every neutral is derived from the accent hue. A component that hard-codes a gray or a white alpha breaks on light themes and on sampled accents.
**The Provider Rule.** A provider's brand color appears only on things that belong to that provider (`usage.ts` `BRANDS`). Everything else uses the accent.
**The Wallpaper Rule.** The wallpaper shows only on the new-chat empty state. It may supply the accent; it never tints surfaces directly.

## Typography

**UI Font:** Inter, bundled. **Mono:** JetBrains Mono, bundled, for code, commands and paths only; status lines and titles are prose and stay in the UI font. Fonts are changeable in settings and not binding.

**Character:** Plain and professional; hierarchy comes from weight jumps, not size sprawl. Numerals that line up (times, counts, costs) use tabular figures.

### Hierarchy
- **Title** (600, 1.14rem): dialog and page titles.
- **Body** (400, 0.93rem): chat and content.
- **Label** (500, 0.86rem): controls, rows, metadata.
- **Heading** (600, 0.79rem, uppercase tracking): group headers like NEEDS YOU.

Four sizes only, in rem so the UI-size setting scales everything. Nothing is set below 0.79rem (11px at the default size).

## Layout

The window is a floating-panel layout: ground, then inset panels with a 0.4rem margin, a shared header band, and chrome islands aligned to one baseline (`--chrome-*` tokens). Spacing is an 8px grid with a 4px half step. Content width is capped; lists are dense but breathing. Under the mobile breakpoint the sidebar becomes a drawer.

## Elevation & Depth

Tonal first. Panels are separated from ground by one fill step plus one hairline. Only floating things cast shadow, from three roles:
- **Pop** (`--shadow-pop`): menus, dropdowns, toasts, composer popups.
- **Dialog** (`--shadow-dialog`): centered cards, pickers, command palette.
- **Drawer** (`--shadow-drawer`): the mobile sidebar.

"Frosted" is a user setting that makes floating surfaces 72% opaque with a 16px blur; it changes the float tokens only.

### Named Rules
**The Even Edge Rule.** A hairline is the same on all four sides. No brighter top edge, no inset highlight, no bevel.
**The Three Levels Rule.** Ground, panel, floating. An outline appears only where fill cannot separate: floating over content, and inputs on a same-tone surface. Rows, groups, tabs and message parts separate by space, a hover wash or a hairline between sections, never a box.
**The Lamp Rule (state).** Urgency is a lit dot plus a heavier title, never an outlined or tinted card.
**The Lamp Rule.** The only gradient in the control set is the lamp glow on Effort and Mode sliders.

## Shapes

Radii are chosen by nesting depth, concentric by the inset rule (child radius = container radius minus the gap):
- **lg 10px**: containers that hold controls (menus, popovers, cards, dialogs, chrome islands).
- **sm 6px**: controls and rows (inputs, buttons, menu items, sidebar rows).
- **xs 4px**: anything inside a control (chips, kbd, badges).
- **float 14px**: the composer and the ask card that joins it. Nothing else.
- **Pill**: true binary toggles, tags and picker triggers. A stretched switch bead stays a pill.
Circles (`50%`) for avatars, dots and rings. New code picks lg/sm/xs; `-md` and `-xl` are legacy aliases.

## Components

### Buttons and controls
Flat, solid fills. Height from `--ctrl-h` (2rem default); a place that needs another size sets the variable. Press scales the button's container layer only, never the label. Held things (sliders) follow the pointer with no easing and ease only on release.

### Fields
Sunk fill (`--field-bg`), hairline edge. Focus lifts the fill and adds a faint accent ring (3px at 14%); the border never turns accent.

### Menus and popovers
`--float-bg`, lg radius, pop or dialog shadow, shared float-in/out motion (0.16s in, 0.12s out).

### Sidebar tiers
Needs you, Working, Ready: state is shape and lamp, not sentences. A chat that needs the user shows a lit dot (the **lamp**: 7px, warning color, a 3px halo at 20%) and a heavier title, with a count on the section label. No outline and no card. The same lamp marks that chat's tab. Amber means "needs you" and nothing else: a notice, a dirty count, a favorite or a work row stays neutral.

### Composer and ask
One floating surface. When an agent asks a question, the ask card sits on top of the composer and the composer's top edge is the only line between them (14px outer corners, square where they meet). Never two stacked cards. The no-sandbox notice is the same width as the composer and tucks under its top corners before the first message; after that a short label stays beside the mode (a phone, with no mode button, keeps the notice). In an approval, Reject has a fill like any button and reddens on hover; it's the safe choice, so it's never weaker than Allow.

### Status bar
At rest it shows only what's nowhere else: server health, branch, usage, spend, the bell. Counts the sidebar already shows (waiting, running) and secondary widgets fade in when the bar is pointed at; the counts show at rest only while the sidebar is hidden.

## Do's and Don'ts

### Do:
- **Do** derive any new color from `--accent`, `--text`, `--panel-bg` or the wash tokens.
- **Do** pick a radius by nesting depth: lg, sm, xs. Use `--radius-float` only for the composer and ask card.
- **Do** keep a screen to one focal element and push secondary numbers behind a drill or tab.
- **Do** use `calc(<base> * var(--anim-speed))` for durations.

### Don't:
- **Don't** write `rgba(255,255,255,x)`, a hex gray, or a one-off shadow in a component.
- **Don't** add top highlights, inner glows or bevels to surfaces, or outline a row to make it urgent.
- **Don't** use accent as a decorative color or on a provider-owned element.
- **Don't** animate a held control or rotate chevrons (flip them).
- **Don't** add a gradient outside the lamp.
