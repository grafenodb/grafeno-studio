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
| `Grafeno Desktop_0.2.0_x64-setup.exe` | 4,127,527 bytes | `DC3D2B3666DC6A6E6D94861308DD45BEFA8C30884930F154AD673900937E6C41` |
| `Grafeno Desktop_0.2.0_x64_en-US.msi` | 5,627,904 bytes | `98FC433C92F3A5496301596FD78E32A926AE4374339809A20848256EC2B5571D` |

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
| `Grafeno Desktop_0.2.0_amd64.deb` | 7,327,612 bytes | `A4507CCF828DD824BE934B9E27DB966B0BEA41427B59AD0362EF70E71F6B84A5` |
| `Grafeno Desktop-0.2.0-1.x86_64.rpm` | 7,331,454 bytes | `7FEB8F411A9B97ED31E6E6A9861C512805251ACDF33CFBDA6F87C198FB635F81` |

Package metadata reports `grafeno-desktop` 0.2.0 for `amd64`/`x86_64`.
Both packages contain `/usr/bin/grafeno-desktop`, the desktop entry and the
Grafeno icons. Neither package contains a Grafeno engine binary.

## AppImage and release boundary

The AppImage is produced by the native Ubuntu 22.04 job in
`.github/workflows/release.yml`. It is not emitted by the Debian/Fedora
container, whose purpose is repeatable `.deb` and `.rpm` packaging. A tagged
release should still run the workflow to produce the AppImage, optional
Windows signatures, stable download names, checksums and release uploads.
