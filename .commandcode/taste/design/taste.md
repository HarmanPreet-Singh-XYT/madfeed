# Design Taste

- Separates marketing styling from product styling: generous rounded corners are fine on the landing page but feel excessive inside the product/app itself, which should use noticeably tighter radii. Confidence: 0.75
- Avoids purple gradients in UI; prefers restrained, cohesive palettes, with light mode as the default theme and a theme toggle that actually works. Confidence: 0.7
- Product screens should be built from the shared UI component library (shadcn/ui primitives) rather than hand-rolled markup and ad-hoc class strings; consistency comes from the primitives, not from repeating raw HTML. Confidence: 0.7
- Treats default native browser controls as visible prototype tells in product UI — a bare `<input type="file">` "Choose File / No file chosen", an unstyled `<progress>`, or a native `datetime-local` field should be replaced with custom-styled equivalents (drag-and-drop drop zone, styled progress bar with cancel, a composed calendar+time popover, matching comboboxes) that match the rest of the design system. Expects a "real" picker even when the native one works. Confidence: 0.75
- Design proposals and audits must land in the product's existing brand language (its own tokens, type scale, palette), not an outside/generic design language borrowed from reference screenshots. Confidence: 0.6
- Judges UI by whether it reads as a finished product rather than a prototype, and will reject work that feels demo-like (hero banners, floating/loose chrome, detached primary actions, placeholder-feeling layout) even when it functions correctly. Confidence: 0.65
