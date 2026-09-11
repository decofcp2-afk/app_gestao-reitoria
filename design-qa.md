# Design QA — Gestão de Atas

- Source visual truth: `C:\Users\Samuel Gomes\Desktop\app_gestao-reitoria\.codex-remote-attachments\01a08d3a-2edf-7fc1-a0f8-c7f2eaefbe5c\9ebd144f-3113-4367-98da-666f628ecfc7\1-Photo-1.jpg`
- Source pixels: 1280 × 905.
- Desktop implementation: `implementation-gestao-atas-desktop.png` — 1440 × 1000 CSS px, device scale 1.
- Mobile implementation: `implementation-gestao-atas-mobile.png` — 390 × 844 CSS px, device scale 1.
- Combined comparison: `comparison-gestao-atas.png`.
- Mobile menu source: `C:\Users\Samuel Gomes\Desktop\app_gestao-reitoria\.codex-remote-attachments\01a08d3a-2edf-7fc1-a0f8-c7f2eaefbe5c\8bb2ee28-dd67-437d-b168-b09eb9e96835\1-Photo-1.jpg`.
- Corrected mobile menu: `menu-mobile-corrigido.jpg`; combined comparison: `comparison-menu-mobile.jpg`.
- Team-management sources: `C:\Users\Samuel Gomes\Desktop\app_gestao-reitoria\.codex-remote-attachments\01a08d3a-2edf-7fc1-a0f8-c7f2eaefbe5c\c6c26736-b9bd-4d2f-ae42-b442f54f76d0\1-Photo-1.jpg` and `2-Photo-2.jpg`.
- Team-management implementation: inspected in the in-app Browser at 390 × 844 CSS px with planning, complete server cards and the edit-server sheet open.
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
- Process notifications now expose only “Vencidos” and “Prazos próximos”; the Pontuação category is absent.
- Gestão da Equipe shows the operational availability summary before the server list on mobile, and each server edit sheet exposes E-mail immediately after Matrícula.
- A ausência confirmada dos acionadores abre um diálogo central obrigatório, sem fechar pelo fundo ou por botão; a instalação confirmada remove o diálogo e não deixa card permanente na Gestão da Equipe.
- Browser console checked after the flows: no errors or warnings.

## Comparison history

1. Initial intermediate-width capture showed the search area clipped at 775 px (P2). Fixed by moving the responsive filter/grid breakpoint to 899 px. Post-fix evidence: mobile screenshot has `scrollWidth = clientWidth = 390`.
2. Initial preview notification refresh tried to use a real unauthenticated backend session (interaction P1). Fixed by isolating preview notification refresh. Post-fix: Atas/Processos scope and Gestão da Equipe flows passed without logout or console errors.
3. Production mobile capture showed the feature-gated Gestão de Atas item absent while its asynchronous permission check was still running (P1) and Histórico lacked its expected visual marker (P3). Fixed by immediately exposing the entry for the known `reitoria-sel` pilot while the backend confirms the flag, and by adding the approved menu markers. Post-fix evidence: `comparison-menu-mobile.jpg` at 390 × 844.
4. The first compact server card placed the new e-mail beside both actions, causing awkward wrapping at 390 px (P2). Fixed by stacking the identity block above full-width Editar/Remover actions on mobile. The final capture keeps the e-mail readable and the actions comfortably tappable.
5. The first automation entry occupied permanent space in Gestão da Equipe after configuration (P2). It was replaced by a centered blocking dialog shown only after a confirmed missing-trigger response. Both missing and installed preview states were inspected; the installed state leaves no automation card behind.

## Findings

No actionable P0, P1 or P2 findings remain.

Accepted differences from the wireframe:

- KPI quantities use the local realistic fixture rather than the mock's illustrative totals.
- A single textual “Ver” action replaces the mock's three icon actions, consistent with the approved simplified MVP.
- Pagination remains visually compact while the result set fits on one page.

## Follow-up polish

- P3: evaluate a vetted local icon set later if more row actions are approved.

final result: passed
