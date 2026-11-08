# Studio design v2 validation

Validated on 2026-11-08 against the shared Grafeno Studio production bundle.

## Scope

- Traditional File, Edit, View, Query, Tools and Help menus with keyboard
  navigation and context-aware disabled states.
- A separate full-width module bar and compact workspace tab strip.
- Neutral dark workbench surfaces with restrained Grafeno teal accents.
- Light, Dark and live System theme modes.
- Centered sidebar theme controls in expanded and collapsed layouts.
- One connection presentation in the status bar, not the header.
- A reusable, collapsible and horizontally resizable inspector.
- Natural-height Overview data and consistent user-facing “facts” wording.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run typecheck --prefix studio` | Passed. |
| `npm run build --prefix studio` | Passed; 77 modules transformed. |
| `npm test --prefix studio` | Passed; 58 tests. |
| `cargo check --manifest-path desktop/Cargo.toml` | Passed. |
| `npm run lint --prefix studio` | Not available: Studio has no `lint` script. |

## Browser checks

The production build was exercised with Playwright at 1920×1080, 1440×900
and 1366×768 against a deterministic Grafeno HTTP mock.

- Mouse and keyboard menu operation, including arrows and Escape.
- File creation actions, Query creation/execution and Help dialogs.
- Light, Dark and System theme transitions; System reacted to live simulated
  operating-system preference changes.
- Sidebar collapse/expand, centered three-mode theme selector and reset.
- Inspector resize/collapse/expand.
- Twelve workspace documents with horizontal tab overflow; activating a
  document scrolls its tab back into view.
- Long namespace names, full-width module distribution and right-edge menus.
- No page-level horizontal overflow, clipped primary regions or console/page
  errors in the covered routes.

The mock does not implement Memory's specialized response shape. Opening that
route with the mock was excluded after it correctly exposed the fixture gap;
Memory's existing automated tests and production code were not changed.
