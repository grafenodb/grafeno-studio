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
| `Grafeno Desktop_0.2.0_x64-setup.exe` | 4,128,956 bytes | `AE3DF278D615882A145728BDC6F90D21FE0E7E1BB6ACC2DDCEE008F9AAD6F864` |
| `Grafeno Desktop_0.2.0_x64_en-US.msi` | 5,627,904 bytes | `DBE64DA5A39FFB2EE9E9D897731414A2C4AD15196FAC5C1497F3654F3077143F` |

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
| `Grafeno Desktop_0.2.0_amd64.deb` | 7,326,236 bytes | `6934A644A79FF829E412D87CE5D6CD8AF6C61980BFB22348CBB902828EA1B5E8` |
| `Grafeno Desktop-0.2.0-1.x86_64.rpm` | 7,329,426 bytes | `1956CFA067877583072F2FA53CEC44C5BF7BE238A6B89214E9102226B4F7E44D` |

Package metadata reports `grafeno-desktop` 0.2.0 for `amd64`/`x86_64`.
Both packages contain `/usr/bin/grafeno-desktop`, the desktop entry and the
Grafeno icons. Neither package contains a Grafeno engine binary.

## AppImage and release boundary

The AppImage is produced by the native Ubuntu 22.04 job in
`.github/workflows/release.yml`. It is not emitted by the Debian/Fedora
container, whose purpose is repeatable `.deb` and `.rpm` packaging. A tagged
release should still run the workflow to produce the AppImage, optional
Windows signatures, stable download names, checksums and release uploads.
