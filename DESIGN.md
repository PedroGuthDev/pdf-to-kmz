---
name: PDF to KMZ
description: Calm utility surface for PDF route extraction and KMZ export
colors:
  canvas: "#f7f5f1"
  surface: "#ffffff"
  surface-muted: "#f0ede6"
  surface-step: "#e8f0ec"
  ink: "#1c1b19"
  ink-muted: "#5c5852"
  ink-subtle: "#8a847a"
  border: "#ddd8ce"
  border-strong: "#c4bdb0"
  accent: "#2d6b5a"
  accent-hover: "#245a4b"
  accent-soft: "#e3efe9"
  success: "#1f5c38"
  success-bg: "#e8f3ec"
  success-border: "#b8d4c4"
  warning: "#6b4e12"
  warning-bg: "#faf3e3"
  warning-border: "#e8d4a8"
  error: "#8b1f2e"
  error-bg: "#fceef0"
  error-border: "#e8b4bc"
  info-bg: "#f0ede6"
  info-border: "#ddd8ce"
  code-bg: "#f0ede6"
  debug-bg: "#232320"
  debug-ink: "#d8d4c8"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, \"Cascadia Code\", \"Segoe UI Mono\", monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "10px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  panel-step:
    backgroundColor: "{colors.surface-step}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
---

# Design System: PDF to KMZ

## Overview

**Creative North Star: "The Field Notebook"**

A single-column workflow on warm paper-toned canvas. Structure comes from numbered steps and quiet panels, not cards or sidebars. Typography is native system UI; color does the minimum work (accent for actions, semantic tints for status). Debug and comparison blocks use monospace on muted or dark surfaces so data reads as data, not marketing.

**Key characteristics:**

- Light theme for desk/daylight use
- Restrained palette: one green accent, warm neutrals
- Flat surfaces; borders and background shifts instead of shadows
- Step panels (`surface-step`) for coordinate entry only
- No modals, no hero blocks, no decorative motion

## Colors

Palette character: warm stone neutrals with a cartographic green accent (infrastructure, maps, trust).

### Primary

- **Route Green** (`#2d6b5a` / oklch(0.45 0.08 165)): Primary buttons, step emphasis, links. Used on less than 10% of the viewport.

### Neutral

- **Canvas** (`#f7f5f1` / oklch(0.97 0.008 85)): Page background
- **Surface** (`#ffffff`): Inputs, main content panels
- **Surface Muted** (`#f0ede6`): Summary blocks, code preview
- **Surface Step** (`#e8f0ec`): Step 2 coordinate form panel
- **Ink** (`#1c1b19`): Headings and body
- **Ink Muted** (`#5c5852`): Secondary copy
- **Border** (`#ddd8ce`): Dividers and panel outlines

### Semantic

- **Success / Warning / Error**: Background + border pairs listed in frontmatter; text colors meet AA on their backgrounds.

**The One Accent Rule.** Route Green appears only on primary actions and rare emphasis. Everything else is neutral or semantic.

## Typography

**Body / UI:** System UI stack (see frontmatter).

**Mono:** `ui-monospace` stack for previews, reference textarea, debug dump.

### Hierarchy

- **Title** (600, 1.75rem): Page title only
- **Section** (600, 1.125rem): Step headings
- **Label** (600, 0.875rem): Form labels
- **Body** (400, 1rem, line-height 1.55): Prose and status; max ~70ch for intro copy
- **Mono** (400, 0.8125rem): `pre`, `textarea`, comparison tables

## Elevation

Flat-by-default. Depth is conveyed with background steps (`canvas` → `surface` → `surface-step`) and 1px borders, not box-shadows. The debug block is the exception: dark `debug-bg` to separate diagnostic output from the workflow.

## Components

### Buttons

- **Shape:** 6px radius, 10px × 16px padding
- **Primary:** Route Green fill, white label; hover → accent-hover
- **Secondary:** White fill, ink text, border-strong outline; for compare actions

### Panels

- **Summary / warnings:** surface-muted or semantic bg + matching border, md radius
- **Step form:** surface-step background, md radius, lg padding

### Inputs

- White surface, border outline, sm radius, full width on mobile
- Focus: 2px accent ring (outline), no layout shift

### Status banner

- Full-width block below upload; semantic background + border; bold first line optional

## Do's and Don'ts

**Do**

- Keep the three-step flow visible in document order
- Use semantic status classes (success, warning, error, info)
- Tie labels to inputs with `for` / `id`
- Prefer inline expansion over modals

**Don't**

- Add card grids, side navigation, or dashboard chrome
- Use pure `#000` / `#fff` or gradient text
- Animate layout properties
- Hide parser warnings to reduce visual noise
