# Grafeno Desktop

**Español** | [English](README.md)

Grafeno Studio en ventanas nativas, hecho con [Tauri](https://tauri.app).
**No lleva el motor dentro**: habla con los motores de Grafeno solo por su
API HTTP, como cualquier cliente, y se instala aparte del motor (como
pgAdmin aparte de PostgreSQL). Cada ventana tiene su propia conexión:

- **Un archivo de base de datos en este equipo** (`.redb`): la app arranca
  el motor de Grafeno instalado en la máquina para esa ventana, como
  `grafeno serve --db ARCHIVO --addr 127.0.0.1:0 --token <uno de la sesión>
  --stop-with-stdin`, en un puerto de loopback, y le habla por HTTP. El
  Studio nunca ve el puerto ni el token. Cerrar el archivo, abrir otro,
  cerrar la ventana o que la app termine (incluso si se cae) cierra la
  entrada estándar del motor, y el motor se detiene limpio. Sin motor
  instalado, la pantalla de inicio lo dice y enlaza a sus instaladores.
- **Un servidor de Grafeno**: el servicio instalado en este equipo
  (detectado en su dirección por defecto, `127.0.0.1:7810`), uno en otra
  máquina, o un clúster por sus miembros (`http://a:7810, http://b:7810`).
  Los servidores quedan en una lista en la pantalla de inicio. Conectar
  tiene dos pasos: primero la dirección y el token del servidor (`grafeno
  config token`, en el servidor), que debe ser aceptado; después inicia
  sesión un administrador (un superusuario) con su nombre y contraseña, y
  la ventana trabaja como esa cuenta. Un servidor sin cuentas ofrece crear
  su primer administrador con el token; "Continue with the token only"
  trabaja con los permisos del token, sin cuenta.

La aplicación sí incluye SQLite para datos exclusivos del cliente, como la
biblioteca local de scripts. Esa base vive en el directorio privado de
configuración de la aplicación y no pertenece a ninguna base o servidor de
Grafeno. No hace falta instalar SQLite ni otro servicio.

Se pueden abrir varias ventanas a la vez (Archivo → Nueva ventana,
Ctrl+Shift+N), cada una con su archivo o servidor. Al conectar, el Studio
revisa el motor (`GET /v1/about`): rechaza uno sin versión de la API en
común y oculta las vistas que el motor no ofrece.

## Cómo encuentra el motor

En orden: `GRAFENO_BIN`; `grafeno` en el `PATH`; donde lo dejan los
instaladores del motor (`C:\Program Files\Grafeno\grafeno.exe` en
Windows; `/usr/bin/grafeno`, `/usr/local/bin/grafeno`,
`~/.local/bin/grafeno` en Linux). Usa el primero que responde a
`grafeno --version`; la pantalla de inicio muestra cuál.

## Compilar

```bash
cd studio && npm ci && npm run build
```

```bash
cd desktop && cargo run
```

```bash
cd desktop && npx tauri build
```

El último genera los instaladores (`.exe` y `.msi` en Windows; `.deb`,
`.rpm`, `.AppImage` en Linux); ninguno lleva motor.

## Pruebas

```bash
GRAFENO_BIN=/ruta/a/grafeno cargo test
```

Corren contra el binario real del motor: un archivo servido por el motor
en un puerto de loopback, el token obligatorio, un respaldo por la API
recuperado con `grafeno restore`, un archivo que ya usa otro motor
rechazado, el cierre que detiene el motor limpio (el archivo se reabre con
sus datos), ningún motor que quede corriendo al terminar una sesión, y un
archivo que el motor no puede abrir rechazado con su motivo. Los detalles
(funcionamiento, prueba de ventana en Linux, la medición Tauri contra
Electron) están en el [README en inglés](README.md).
