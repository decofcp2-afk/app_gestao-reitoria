# Design QA — Gestão de Atas

- Source visual truth: `C:\Users\Samuel Gomes\Desktop\app_gestao-reitoria\.codex-remote-attachments\01a08d3a-2edf-7fc1-a0f8-c7f2eaefbe5c\9ebd144f-3113-4367-98da-666f628ecfc7\1-Photo-1.jpg`
- Source pixels: 1280 × 905.
- Desktop implementation: `implementation-gestao-atas-desktop.png` — 1440 × 1000 CSS px, device scale 1.
- Mobile implementation: `implementation-gestao-atas-mobile.png` — 390 × 844 CSS px, device scale 1.
- Combined comparison: `comparison-gestao-atas.png`.
- State: local read-only preview with realistic CPII procurement data; Gestão de Atas selected.

## Full-view comparison evidence

The side-by-side comparison preserves the approved structure: horizontal institutional header, title/action row, four KPI cards, compact filter row, dense operational table, status pills and restrained CPII blue/gray palette. The implementation deliberately uses the current App Gestão shell and its bottom navigation, because the mock represented the new module inside that existing product.

## Required fidelity surfaces

- Fonts and typography: existing system font stack preserved; hierarchy, weights, tabular KPI numbers and compact table labels match the reference intent.
- Spacing and layout rhythm: title, KPI, filters and table follow the same vertical order and density. Desktop grid and mobile stacking were inspected at 1440 × 1000 and 390 × 844.
- Colors and tokens: existing navy, blue, border and semantic green/yellow/blue/red tokens were reused. Contrast remains legible.
- Image and asset fidelity: the module has no content imagery. Existing CPII branding is preserved; no placeholder imagery was introduced.
- Copy and content: labels use the approved terminology, including “Atas vencidas”, “Vencendo em 90 dias”, “Aguardando dados” and “Compras.gov.br somente leitura”.

## Interaction evidence

- Primary navigation and Gestão de Atas route opened.
- Search reduced the table to the expected single row.
- Official/manual mode switch exposed the manual date fields.
- Detail drawer opened with official fields read-only and internal fields editable.
- Notification scope opened in Atas, displayed two ata alerts, and hid overdue process alerts under Processos.
- Gestão da Equipe opened with availability/férias and server e-mail areas.
- Browser console checked after the flows: no errors or warnings.

## Comparison history

1. Initial intermediate-width capture showed the search area clipped at 775 px (P2). Fixed by moving the responsive filter/grid breakpoint to 899 px. Post-fix evidence: mobile screenshot has `scrollWidth = clientWidth = 390`.
2. Initial preview notification refresh tried to use a real unauthenticated backend session (interaction P1). Fixed by isolating preview notification refresh. Post-fix: Atas/Processos scope and Gestão da Equipe flows passed without logout or console errors.

## Findings

No actionable P0, P1 or P2 findings remain.

Accepted differences from the wireframe:

- KPI quantities use the local realistic fixture rather than the mock's illustrative totals.
- A single textual “Ver” action replaces the mock's three icon actions, consistent with the approved simplified MVP.
- Pagination is omitted while the result set fits on one page; the footer reports the displayed total.

## Follow-up polish

- P3: add pagination controls when production volume exceeds the first page size.
- P3: evaluate a vetted local icon set later if more row actions are approved.

final result: passed
