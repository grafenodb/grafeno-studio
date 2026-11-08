# Desktop packaging validation

Validated on 2026-11-08 from the shared Grafeno Studio production bundle.
Generated packages are build artifacts and remain outside Git.

## Windows x64

Built on Windows with:

```powershell
npm run build --prefix desktop -- --bundles nsis,msi
```

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `Grafeno Desktop_0.2.0_x64-setup.exe` | 4,131,823 bytes | `3C03EEB8D3B7EA4D518820CE673923AC33769009AE1E6EC85F4013BB2AD58007` |
| `Grafeno Desktop_0.2.0_x64_en-US.msi` | 5,627,904 bytes | `EA5C00EC234C7B9862CA1484DAD1B4821B06F8F554754539C5FDFF0D3C8A7D68` |

Both packages were generated successfully by Tauri 2. The local artifacts
are unsigned because no release certificate was supplied. The release
workflow signs them when `WINDOWS_CERTIFICATE` and
`WINDOWS_CERTIFICATE_PASSWORD` are configured.

## Linux x86-64

Built in the repository's Debian 12 container with:

```powershell
docker buildx build -f desktop/packaging/Dockerfile --output dist/desktop .
```

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `Grafeno Desktop_0.2.0_amd64.deb` | 7,327,554 bytes | `95E7CE89F13BF01963B3BD7DFA3BD32577901F0247E62EF42A9FECF8D9398B4C` |
| `Grafeno Desktop-0.2.0-1.x86_64.rpm` | 7,331,009 bytes | `DACBB4F72477E20F0B20AB887E957398CB2C96E006CC197E2C62E3452A3AF696` |

Package metadata reports `grafeno-desktop` 0.2.0 for `amd64`/`x86_64`.
Both packages contain `/usr/bin/grafeno-desktop`, the desktop entry and the
Grafeno icons. Neither package contains a Grafeno engine binary.

## AppImage and release boundary

The AppImage is produced by the native Ubuntu 22.04 job in
`.github/workflows/release.yml`. It is not emitted by the Debian/Fedora
container, whose purpose is repeatable `.deb` and `.rpm` packaging. A tagged
release should still run the workflow to produce the AppImage, optional
Windows signatures, stable download names, checksums and release uploads.
