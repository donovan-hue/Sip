# 🧠 Sinapsis — Tu segundo cerebro en 3D

Aplicación web de conocimiento personal estilo **Obsidian, pero con red neuronal 3D** y estética de **IA de trading**: notas en Markdown + conversaciones con IA (ChatGPT, Gemini) y chats (WhatsApp, Messenger) conectados como una red neuronal fosforescente sobre fondo negro puro.

100% local y privada: todo se guarda en tu navegador (localStorage). Sin servidores, sin cuentas, sin rastreo.

![hecho con](https://img.shields.io/badge/JS-Vainilla%20%2B%20three.js-a020ff) ![licencia](https://img.shields.io/badge/licencia-MIT-39ff14)

## ✨ Funciones

- **📝 Notas Markdown** con vista previa en vivo, `[[wikilinks]]` con autocompletado, etiquetas, backlinks y esquema.
- **💬 Conversaciones importadas**: ChatGPT (`conversations.json`), Gemini (Takeout), WhatsApp (`.txt`), Messenger (`message_1.json`) y cualquier IA (JSON/texto pegado). Se leen como burbujas de chat y se convierten en nodos de la red.
- **🧠 Red neuronal 3D** (three.js + bloom):
  - Esferas con borde neón (fresnel) + malla wireframe, sin brillo excesivo.
  - Colores fosforescentes que rotan solos en bucle infinito (fucsia, verde, azul, morado, rojo).
  - **Señales ⚡ viajando punto a punto** por las conexiones, como sinapsis.
  - Rejilla holográfica, anillos orbitales, auto-rotación cinemática.
  - HUD estilo trading: EN VIVO, señales/min, feed de señales en tiempo real.
  - Las **personas** de tus chats son nodos que conectan conversaciones entre sí.
- **🔌 Conexiones**: conecta una carpeta de tu equipo **una sola vez** y todo export de conversación que caiga ahí se importa automáticamente cada 30 s.
- **⌨️ Atajos**: `Ctrl+K` paleta de comandos · `Ctrl+P` abrir nota · `Ctrl+Alt+N` nueva nota · `Alt+1..5` secciones.

## 🚀 Usarla

### Opción A — GitHub Pages (recomendada)
1. Sube este repositorio a tu cuenta de GitHub.
2. Ve a **Settings → Pages → Build and deployment → Source: Deploy from a branch → main / (root) → Save**.
3. En 1 minuto tu app estará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

### Opción B — En tu equipo
La app usa módulos ES, así que necesita servirse por HTTP (no abrir el `index.html` directo):

```bash
cd sinapsis
python3 -m http.server 8080
# abre http://localhost:8080
```

## 📁 Estructura

```
index.html          interfaz completa
css/style.css       tema espacial / neón
js/app.js           controlador de UI
js/store.js         bóveda (localStorage) + cálculo de la red
js/md.js            render Markdown + wikilinks
js/importers.js     parsers: ChatGPT, Gemini, WhatsApp, Messenger, genérico
js/graph3d.js       motor 3D (three.js): fuerzas, bloom, señales, HUD
js/sync.js          carpeta buzón con auto-importación
js/github.js        respaldo de la bóveda a GitHub (API Contents)
js/samples.js       contenido demo
vendor/             three.js r160 (local, sin CDN)
tests/test-all.mjs  61 pruebas (node tests/test-all.mjs)
```

## 🔒 Privacidad

Tus notas y conversaciones **nunca salen de tu navegador**, excepto lo que tú decidas exportar. La carpeta buzón y GitHub (si lo conectas) funcionan con permisos explícitos tuyos.

## 🧪 Tests

```bash
node tests/test-all.mjs   # 61 pruebas: importadores, grafo, markdown, DOM, sync
```

---
Hecho con 🧠 y three.js · MIT
