---
name: unslop
description: "Final editorial pass for every assistant response and user-facing prose written or edited in websites, applications, and documents. Preserve meaning, voice, code, identifiers, data, quotes, and placeholders that must remain exact."
---

# Unslop

Apply a final editorial pass to prose before returning it or writing it to a user-facing artifact.

## Scope

- **Assistant responses.** Review all visible prose before sending it. Keep code blocks, commands, paths, identifiers, logs, quoted text, and exact data unchanged.
- **Websites and applications.** Review user-facing strings such as headings, labels, errors, empty states, onboarding, notifications, help text, and marketing copy. Preserve interpolation, localization keys, formatting, and technical terms.
- **Documents.** Review the prose we create or edit. Preserve citations, quotes, legal wording, required terminology, and structured content unless the user asks for a rewrite.
- **Technical material.** Do not rewrite code or configuration to make it sound human. Comments and documentation comments may be edited when they are prose and technical meaning remains precise.
- **User-provided text.** Edit it only when the user asks for editing or rewriting. Preserve it when quoting or analyzing it.

## Process

1. Scan the visible prose. For a short response, use the compact pass below. For substantial user-facing copy, read [references/patterns.md](references/patterns.md) and inspect every relevant category.
2. Rewrite only what improves clarity, naturalness, or specificity. Preserve meaning and match the artifact's intended tone.
3. Self-audit: "What makes this obviously AI generated?" Fix remaining tells without adding personality that does not belong in the artifact.

## Compact pass

- Prefer direct, concrete wording over filler, vague claims, and generic conclusions.
- Remove empty introductions, chatbot phrases, excessive hedging, and unnecessary repetition.
- Avoid em dashes, decorative emojis, forced headings, and lists that do not clarify the answer.
- Keep the rhythm natural without forcing a personality that does not belong in the artifact.

## Keep the voice

- **Assistant responses.** Use a direct voice and react to facts instead of listing empty pros and cons.
- **Websites, applications, and documents.** Keep the project's existing voice and level of formality. Do not add personality, informality, or imperfection just to avoid an AI tone.
- **Every artifact.** Prefer concrete wording and specific facts over vague claims.

## Full pass

Read [references/patterns.md](references/patterns.md) before editing substantial prose in a website, application, or document, or when the user explicitly asks for a detailed copy edit.
