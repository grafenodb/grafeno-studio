# Workspace validation

Validated on 2026-11-08 for the shared Grafeno Studio web bundle and the
Tauri desktop host. Installer packaging is intentionally outside this phase.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run build --prefix studio` | Passed; Vite production bundle generated from 76 modules. |
| `npm test --prefix studio` | Passed; 58 tests. |
| `cargo fmt --manifest-path desktop/Cargo.toml -- --check` | Passed after applying the repository formatter. |
| `cargo test --manifest-path desktop/Cargo.toml` | Passed; 12 tests, including loopback bridge and engine lifecycle coverage. |

The two loopback tests require normal Windows socket access. Their initial
sandboxed run was denied by Windows (`os error 10013`); the unrestricted test
run passed all 12 tests.

## Browser matrix

The production bundle was exercised against a deterministic mock of the
Grafeno HTTP API so that the visual states are repeatable.

| Viewport | State exercised | Result |
| --- | --- | --- |
| 1920 x 1080 | Light Overview, three namespaces, long namespace names | Passed; one global Overview tab and no page-level horizontal overflow. |
| 1440 x 900 | Explorer list and node details | Passed; repeated node selections reused the active Explorer document. |
| 1366 x 768 | Scripts editor, results and vertical splitter | Passed; query results rendered and the editor/results split resized without mounting a graph view. |
| 1024 x 768 | Graph workspace, filters and responsive inspector | Passed; controls remain reachable and inspection uses the compact layout. |

Additional shell checks covered the nine capability-aware toolbar modules,
loaded local fonts, light/dark theme switching, command palette, collapsible
and resizable namespace sidebar, tab restoration, and rapid view changes.
Inactive graph documents unmount their renderer instead of covering the tab
strip or retaining canvas resources.

The result-table copy controls were present and invokable. Reading the system
clipboard back from the sandboxed browser stalled the automation controller,
so clipboard contents were not used as release evidence; the underlying copy
and JSON behavior remains covered by the Studio test suite.

## Web and Desktop parity

Web and Tauri consume the same `studio/dist` production output. The web bundle
completed the browser matrix, while the desktop crate compiled that bundle's
bridge and passed its 12 native tests. This validates the shared application
before packaging without claiming a native installer smoke test.

## Packaging boundary

Packaging was intentionally deferred from this validation phase and completed
in the following phase. See
[`packaging-validation.md`](packaging-validation.md) for the generated Windows
and Linux packages, checksums and remaining release-CI boundary.
