---
name: Inclusion Harmonic
colors:
  surface: "#fbf9f8"
  surface-dim: "#dbdad9"
  surface-bright: "#fbf9f8"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#f5f3f3"
  surface-container: "#efeded"
  surface-container-high: "#eae8e7"
  surface-container-highest: "#e4e2e2"
  on-surface: "#1b1c1c"
  on-surface-variant: "#3e4946"
  inverse-surface: "#303030"
  inverse-on-surface: "#f2f0f0"
  outline: "#6e7a76"
  outline-variant: "#bdc9c5"
  surface-tint: "#006b5c"
  primary: "#00695b"
  on-primary: "#ffffff"
  primary-container: "#1d8473"
  on-primary-container: "#fdfffd"
  inverse-primary: "#7bd7c3"
  secondary: "#785a00"
  on-secondary: "#ffffff"
  secondary-container: "#fcc431"
  on-secondary-container: "#6e5200"
  tertiary: "#ab285f"
  on-tertiary: "#ffffff"
  tertiary-container: "#cb4378"
  on-tertiary-container: "#ffffff"
  error: "#ba1a1a"
  on-error: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  primary-fixed: "#97f3df"
  primary-fixed-dim: "#7bd7c3"
  on-primary-fixed: "#00201b"
  on-primary-fixed-variant: "#005045"
  secondary-fixed: "#ffdf9d"
  secondary-fixed-dim: "#f6be2a"
  on-secondary-fixed: "#251a00"
  on-secondary-fixed-variant: "#5b4300"
  tertiary-fixed: "#ffd9e2"
  tertiary-fixed-dim: "#ffb1c7"
  on-tertiary-fixed: "#3e001c"
  on-tertiary-fixed-variant: "#8c0948"
  background: "#fbf9f8"
  on-background: "#1b1c1c"
  surface-variant: "#e4e2e2"
  support-green: "#76C043"
  calm-blue: "#2E99B0"
  surface-gray: "#F9FAFB"
  border-low: "#E5E7EB"
  focus-ring: "#2563EB"
typography:
  display-lg:
    fontFamily: Fira Sans
    fontSize: 48px
    fontWeight: "700"
    lineHeight: "1.2"
  headline-lg:
    fontFamily: Fira Sans
    fontSize: 32px
    fontWeight: "600"
    lineHeight: "1.3"
  headline-lg-mobile:
    fontFamily: Fira Sans
    fontSize: 28px
    fontWeight: "600"
    lineHeight: "1.3"
  headline-md:
    fontFamily: Fira Sans
    fontSize: 24px
    fontWeight: "600"
    lineHeight: "1.4"
  body-lg:
    fontFamily: Fira Sans
    fontSize: 18px
    fontWeight: "400"
    lineHeight: "1.6"
  body-md:
    fontFamily: Fira Sans
    fontSize: 16px
    fontWeight: "400"
    lineHeight: "1.6"
  label-lg:
    fontFamily: Fira Sans
    fontSize: 14px
    fontWeight: "600"
    lineHeight: "1.2"
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Fira Sans
    fontSize: 12px
    fontWeight: "500"
    lineHeight: "1.2"
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  gap-xs: 4px
  gap-sm: 8px
  gap-md: 16px
  gap-lg: 24px
  gap-xl: 32px
  margin-mobile: 16px
  margin-desktop: 40px
  max-width: 1200px
---

## Brand & Style

The design system is built to reflect the core values of CERETI: empathy, institutional reliability, and radical accessibility. The brand personality is "The Professional Companion"—authoritative enough to represent the Universidad Católica de Temuco, yet warm and approachable for students seeking support.

The chosen style is **Corporate / Modern with a focus on Human-Centric Minimalism**. This approach prioritizes information density and clarity over decorative elements, ensuring that users with diverse cognitive and visual needs can navigate the interface without friction. The visual language uses soft edges and a vibrant yet purposeful color palette to evoke a sense of optimism and safety.

Key brand attributes:

- **Clarity:** Every element has a clear function; no visual noise.
- **Dignity:** Design that respects the user's privacy and autonomy.
- **Resilience:** A sturdy, reliable UI that performs consistently across web and mobile.

## Colors

The color strategy is deeply rooted in the CERETI visual identity, optimized for WCAG 2.2 AA compliance.

- **Primary (#1D8473):** A deep teal used for institutional branding, primary actions, and headers. It provides high contrast against white backgrounds.
- **Secondary (#EBB41E):** A warm mustard yellow extracted from the logo. It is used as a highlight and "warm" accent, though text should avoid this color to maintain accessibility.
- **Tertiary (#8E0C4A):** A rich plum used sparingly for critical alerts or specific administrative categorizations.
- **Neutral (#5A5A5A):** The foundation for text and interface borders to ensure readability.

**Usage Guidelines:**

- Use **Primary** for all high-priority functional buttons.
- Use **Surface Gray** for large background areas to reduce eye strain.
- Ensure a minimum contrast ratio of 4.5:1 for all text elements.
- Interaction states (hover, active) should be derived by darkening the primary color by 10-15%.

## Typography

The design system utilizes **Fira Sans** across all levels. This choice supports the institutional nature of the UCT while offering excellent legibility for users with visual impairments due to its humanist characteristics and open apertures.

**Hierarchy Rules:**

- **Emphasis:** Use font weight (SemiBold/Bold) rather than color alone to denote importance.
- **Readability:** Body text is set at a minimum of 16px to ensure comfortable reading on all devices.
- **Line Height:** Generous line heights (1.6 for body) are used to prevent text crowding, aiding users with cognitive disabilities.
- **Alignment:** Always use left-aligned text for paragraphs to maintain a consistent starting point for screen readers and users with dyslexia.

## Layout & Spacing

This design system uses a **Fluid-Fixed Hybrid Grid**. The content is centered within a 1200px max-width container on desktop, but flows fluidly on mobile and tablet devices.

- **Rhythm:** An 8px base unit (linear scale) governs all spacing decisions.
- **Mobile (Up to 600px):** 4-column grid, 16px margins, 16px gutters.
- **Tablet (601px - 1024px):** 8-column grid, 24px margins, 16px gutters.
- **Desktop (1025px+):** 12-column grid, 40px margins, 24px gutters.

**Accessibility Focus:**

- Touch targets for all interactive elements must be at least 44x44px.
- Use "Space-Between" logic for header actions to prevent accidental taps.
- Ensure content flows in a single column on mobile to avoid horizontal scrolling.

## Elevation & Depth

To maintain a clean and professional look, this system avoids heavy shadows. Instead, it uses **Tonal Layers and Low-Contrast Outlines** to define hierarchy.

- **Level 0 (Background):** Solid `#F9FAFB`.
- **Level 1 (Cards/Containers):** White background with a 1px solid border in `#E5E7EB`.
- **Level 2 (Modals/Popovers):** White background with a soft, ambient shadow (0px 4px 12px rgba(0,0,0,0.05)) to suggest floating without creating visual clutter.
- **Focus State:** Interactive elements use a 3px high-contrast outline in `focus-ring` (#2563EB) when navigated via keyboard.

This "Flat-Plus" approach ensures that depth cues are subtle and do not distract from the primary content.

## Shapes

The shape language is **Rounded (8px / 0.5rem)**. This provides a soft, friendly "Companion" feel while remaining structured enough for an institutional context.

- **Buttons & Inputs:** Use the standard 0.5rem radius.
- **Cards:** Use `rounded-lg` (1rem) to softly frame content groups.
- **Avatars/Status Indicators:** Use `rounded-full` (pill-shape) for immediate recognition of non-interactive or specialized status elements.
- **Selection Indicators:** Checkboxes use a 4px radius, while radio buttons remain circular to follow platform conventions.

## Components

### Buttons

- **Primary:** Solid `#1D8473` with white text. Minimum height 48px.
- **Secondary:** Outlined `#1D8473` (2px) with `#1D8473` text.
- **Tertiary/Ghost:** No border, `#1D8473` text, used for less prominent actions like "Cancel."

### Input Fields

- Labels must always be visible above the input (no placeholder-only labels).
- Use a 1px border (#5A5A5A) for high visibility.
- Error states must include both a red border and an error icon/text to satisfy color-blindness requirements.

### Cards

- Used for "Acompañamientos" and "Atenciones."
- White background, 1px border, and 16px padding.
- Include a colored top-border (e.g., `#76C043` for active, `#EBB41E` for pending) as a secondary status indicator.

### Chips/Tags

- Used for "Necesidades de acceso" (e.g., "Intérprete Lense").
- Light gray background with dark text.
- Large enough to be easily dismissible with a clear "X" icon.

### Accessibility Specifics

- **Skip Links:** Provide a "Skip to Content" button for keyboard users.
- **Status Announcements:** Use ARIA live regions for toast notifications (e.g., "Cita agendada con éxito").
- **Contrast Check:** Every component variant must be checked against the `#FFFFFF` and `#F9FAFB` backgrounds to ensure AA compliance.
