# Product

## Register

product

## Users

A single practitioner (network planner, field engineer, or FTTH project owner) working alone at a laptop. They upload INFOVIAS/FTTH route PDFs, paste known GPS anchors for post #1 (and optionally the last post), and need trustworthy coordinates for Google Earth. Context is practical: office or home desk, normal daylight, no time for decorative UI or onboarding tours.

## Product Purpose

Convert fiber-route PDF project files into georeferenced KMZ output. Success means correct relative post placement, clear parse/calc feedback, and a short path from upload to download without accounts, servers, or re-learning the tool each session.

## Brand Personality

Calm, capable, plain-spoken. Three words: **clear**, **trustworthy**, **utilitarian**. The interface should feel like a well-labeled field notebook, not a product launch page.

## Anti-references

- SaaS marketing chrome: hero metrics, gradient accents, glass cards, identical icon grids
- Dark "developer tool" themes by default
- Dense dashboards or side navigation for a three-step workflow
- Playful illustration or empty-state mascots
- Modal-heavy flows when inline steps suffice

## Design Principles

1. **Steps over screens.** One page, visible progression: upload → anchor GPS → output. Never hide the current step.
2. **Show the machine's work.** Parse counts, warnings, and calibration notes stay visible; silence erodes trust for geodata.
3. **Errors are specific.** Name the layer, format, or bound that failed; avoid generic "something went wrong."
4. **Defaults for experts.** Sensible placeholders and optional debug; no forced tutorials.
5. **Restraint is confidence.** One accent, system type, generous whitespace; density only in monospace debug blocks.

## Accessibility & Inclusion

Target WCAG 2.1 AA for text contrast and focus visibility. Respect `prefers-reduced-motion` (no decorative animation). Status uses color plus text; warnings remain readable for common color-vision deficiencies. Form labels stay programmatically associated with inputs.
