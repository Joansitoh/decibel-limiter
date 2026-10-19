# Decibel Limiter - Technical Documentation / Limitador de Decibelios - Documentación Técnica

## English Version

### Overview

The Decibel Limiter is a lightweight browser extension that monitors and controls audio levels in real-time across web pages. It features a **dual-mode architecture** to support both traditional HTML media elements and modern streaming services that use Media Source Extensions (MSE) and Web Audio API streams.

### Table of Contents

1. [Architecture](#architecture)
2. [Core Components](#core-components)
3. [Audio Processing](#audio-processing)
4. [Performance Optimizations](#performance-optimizations)
5. [User Interface](#user-interface)
6. [Technical Challenges](#technical-challenges)

## Architecture

The extension follows a modular architecture with **dual-mode processing** and four main components:

### Processing Modes (v1.5 path policy)

- **Best quality (`audioPath: capture`, default when enabled)**: `tabCapture` → offscreen → lookahead limiter. This is the path users perceive as “real” protection (peaks never heard). Badge: `HQ`.
- **Fullscreen-friendly (`audioPath: element`)**: Content-script `MediaElementSource` per `<audio>`/`<video>`. Keeps player fullscreen; weaker coverage on SPAs/MSE.
- The audio path is a user preference independent of scenarios; scenarios only change sound (ceiling, recovery, leveling).
- **Leveling** (optional): `DynamicsCompressor` + makeup **before** the brickwall; Music scenario disables it.

See `investigate/04-normal-vs-enhanced.md` and `extension/js/presets.js`.

### Components

1. **Content Script** ([content.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/content.js:0:0-0:0)):

   - Runs in the context of web pages
   - Detects and processes traditional HTML media elements
   - Implements real-time audio analysis via Web Audio API
   - Uses MutationObserver for dynamic content detection

2. **Offscreen Document** ([offscreen.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/offscreen.js:0:0-0:0)):

   - Handles enhanced mode processing
   - Uses the browser's tabCapture API (Chromium-based) for universal audio capture
   - Processes entire tab audio stream
   - Supports modern streaming services

3. **Background Script** ([background.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/background.js:0:0-0:0)):

   - Acts as a centralized state manager
   - Orchestrates tab capture sessions
   - Manages extension settings and storage
   - Calculates audio statistics (EMA, peaks)

4. **Popup UI** ([popup.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/popup.js:0:0-0:0), `popup.html`):
   - Provides user controls
   - Displays real-time audio levels
   - Handles enhanced mode toggle
   - Manages user preferences

## Core Components

### Content Script (Normal Mode)

- **Audio Context Management**: Creates and manages Web Audio API context
- **Element Detection**: Uses MutationObserver for dynamic content
- **Audio Processing**: Implements RMS calculation and gain control
- **Event Handling**: Manages audio element lifecycle
- **Shadow DOM Support**: Recursively scans shadow roots
- **Gesture Handling**: Resumes AudioContext on user interaction (autoplay policy)

### Offscreen Document (Enhanced Mode)

- **Tab Capture**: Uses the browser's tabCapture API (Chromium-based) for universal audio access
- **Stream Processing**: Processes entire tab audio stream
- **Identical Algorithm**: Same RMS and gain logic as content script
- **Service Compatibility**: Works with MSE and Web Audio API streams
- **Resource Management**: Proper cleanup of media streams and audio contexts

### Background Script

- **State Management**: Tabs, audio levels, and settings
- **Message Routing**: Handles communication between components
- **Statistics**: Calculates exponential moving averages and peaks
- **Storage**: Per-tab settings in `chrome.storage.local` are removed when a tab closes; when "Apply to all sites" is on, limiter settings live under a single global key, persist across restarts, and are pushed to every open tab
- **Tab Capture Orchestration**: Manages offscreen document lifecycle

### Popup UI

- **Real-time Metering**: Visual feedback of audio levels
- **Configuration**: User settings interface
- **Theme Support**: Light/dark mode detection
- **Localization**: Multi-language support via the extensions i18n API (Chromium-compatible)
- **Enhanced Mode Toggle**: Microphone button for manual activation

## Audio Processing

### Signal Flow

Limiting runs inside an **AudioWorklet** (`extension/js/limiter-processor.js`), on the audio rendering thread — not a main-thread `setInterval` loop. Unlike a simple analysis tap, the worklet sits directly in the signal path: it reads the input, buffers it for a few milliseconds (lookahead), computes the gain from that buffered window, and writes the gain-adjusted result to its own output. Every path still ends in a `DynamicsCompressorNode`, kept purely as a last-resort safety net.

**Normal Mode (Content Script)**, every element gets its own limiter node (independent audio per element):

```
HTML Media Element → MediaElementSource → [AudioWorkletNode: lookahead limiter] → DynamicsCompressor(safety) → Destination
```

**Enhanced Mode (Offscreen Document)**:

```
Tab Audio Stream → MediaStreamSource → [AudioWorkletNode: lookahead limiter] → DynamicsCompressor(safety) → Destination
```

### Lookahead Limiter

A limiter that only reacts *after* seeing a loud sample always lets that sample through at full volume first — that's the "gets loud, then quickly backs off" feeling. To actually prevent audio from ever sounding louder than the ceiling, `extension/js/limiter-processor.js` implements a **lookahead brickwall limiter** (`LookaheadLimiter`):

1. Incoming audio is buffered for `LOOKAHEAD_BLOCKS` render quanta (~10.7ms @48kHz) before being emitted.
2. For each buffered block still waiting to be output, the limiter knows its peak in advance, so it can compute the gain required to respect the configured ceiling across the lookahead window.
3. **Attack** is instant: if a louder block is detected, gain drops immediately — before that block is actually emitted — so it never overshoots the ceiling.
4. **Release** ramps up gradually (dB/sec, per strength preset) once no louder block remains in the window.
5. Gain is interpolated sample-by-sample across each emitted block (linear ramp from the previous applied gain), so there are no clicks — and because of the lookahead, the ramp's start and end are usually already close together by the time a loud block is actually emitted.

See `LookaheadLimiter.process()` in `extension/js/limiter-processor.js` and its self-check in `tests/limiter-processor.test.js` (asserts the output literally never exceeds the ceiling, even right at a sudden peak).

### Key Features

- **Real Lookahead**: gain reduction is ramped in before a loud transient reaches the output, not after
- **Recovery presets**: Fast / Normal / Slow (`soft`/`normal`/`strong` = 15 / 8 / 4 dB/sec)
- **Safety Compressor**: Native `DynamicsCompressorNode` (threshold -3dB, ratio 20:1, ~3ms attack) after the limiter, as a last-resort net
- **Silence Detection**: Ignores paused/inaudible content
- **Live Reduction Readout**: the worklet reports the currently applied gain reduction back to the popup ~20 times/sec

### Gain Algorithm

```javascript
// For each incoming block, compute the gain it would need:
targetGain = min(1, ceilingLin / peak);

// The gain applied to the block about to be emitted already accounts for
// every louder block still buffered ahead of it (the lookahead window):
requiredGain = min(targetGain for every block currently buffered);

if (requiredDB < currentDB) {
  activeGain = requiredGain;                              // ATTACK: instant, zero overshoot
} else {
  activeGain = min(requiredGain, currentGain + releasePerBlock); // RELEASE: gradual
}
```

### Performance Considerations

- **Audio-thread Processing**: No main-thread polling loop; the worklet processes every 128-sample block in-place
- **Throttled UI Updates**: Worklet reports gain/db back to the main thread ~20 times/sec
- **Minimal CPU Usage**: Optimized Float32Array analysis
- **Memory Management**: `Set`/`WeakSet` for element/node tracking
- **History Limit**: 30 samples for moving average calculation

## Performance Optimizations

### Content Script

- **Throttled Updates**: 33ms processing interval
- **Lazy Initialization**: Resources allocated on demand
- **Efficient DOM**: Minimal element manipulation
- **Safe Execution**: Error handling wrapper functions

### Background Processing

- **Batched Updates**: Reduced message frequency
- **Memory Efficiency**: Limited history size (30 samples)
- **Lazy Loading**: Resources loaded when needed
- **Async Operations**: Promisified browser extension APIs

### UI Rendering

- **Throttled Rendering**: 60 FPS limit using performance.now()
- **Debounced Updates**: Reduced reflows
- **Efficient Selectors**: Cached DOM references
- **Color-coded Meter**: Dynamic color based on dB level

## User Interface

### Features

- Real-time level meter with color coding
- Configurable ceiling (-60 to 0 dBFS) with Fast/Normal/Slow recovery presets
- Live applied-gain readout (dB reduction), shown while enabled
- **Apply to all sites**: persists the current limiter setting in `chrome.storage.local` and pushes it to every open tab, so it stays active on any site/domain you visit — not just the current tab
- Enable/disable toggle
- Enhanced mode toggle (mic button)
- Dark, studio-style theme
- Responsive design
- Average dB display with 1 decimal precision

### Accessibility

- Keyboard navigation
- ARIA attributes
- High contrast support
- Semantic HTML structure

### Visual Feedback

- **Green**: Audio under limit
- **Yellow**: Audio approaching limit
- **Red**: Audio exceeding limit (-10 dBFS threshold)

## Technical Challenges

### Cross-Browser Compatibility

- **Target**: Chromium-based browsers (Edge, Opera, etc.)
- **Required APIs**: Web Audio API, tabCapture, offscreen documents
- **Manifest V3**: Uses service worker architecture
- **Feature Detection**: Graceful degradation for unsupported features

### Resource Management

- **Cleanup**: Proper disposal of audio nodes and streams
- **Memory Leaks**: WeakMaps/WeakSets for element tracking
- **Performance**: Efficient event handling and throttling
- **Context Lifecycle**: Proper AudioContext state management

### Edge Cases

- **Dynamic Content**: Handles SPA navigation with MutationObserver
- **Multiple Tabs**: Isolated processing per tab
- **Error Recovery**: Graceful degradation on API failures
- **Streaming Services**: Automatic enhanced mode for MSE-based players
- **Audio Context Suspension**: Resumes on user gesture (autoplay policy)
- **Element Reconnection**: Prevents duplicate MediaElementSource errors

### Modern Streaming Compatibility

- **Media Source Extensions**: Enhanced mode bypasses HTML element limitations
- **Encrypted Media**: Works with DRM-protected content via tab capture
- **Custom Players**: Universal compatibility through tab-level audio capture
- **Web Audio API Streams**: Handles programmatically generated audio

---

## Versión en Español

### Visión General

El Limitador de Decibelios es una extensión ligera para navegadores que monitorea y controla los niveles de audio en tiempo real en páginas web. Cuenta con una **arquitectura de doble modo** para soportar tanto elementos multimedia HTML tradicionales como servicios de streaming modernos que usan Media Source Extensions (MSE) y streams de Web Audio API.

### Tabla de Contenidos

1. [Arquitectura](#arquitectura-1)
2. [Componentes Principales](#componentes-principales-1)
3. [Procesamiento de Audio](#procesamiento-de-audio-1)
4. [Optimizaciones de Rendimiento](#optimizaciones-de-rendimiento-1)
5. [Interfaz de Usuario](#interfaz-de-usuario-1)
6. [Desafíos Técnicos](#desafíos-técnicos-1)

## Arquitectura

La extensión sigue una arquitectura modular con **procesamiento de doble modo** y cuatro componentes principales:

### Modos de Procesamiento

- **Modo Normal**: Para elementos HTML audio/video tradicionales (YouTube, Netflix)
- **Modo Enhanced**: Para servicios de streaming modernos usando MSE/Web Audio API (Disney+, Hulu, SoundCloud)

### Componentes

1. **Script de Contenido** ([content.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/content.js:0:0-0:0)):

   - Se ejecuta en el contexto de las páginas web
   - Detecta y procesa elementos multimedia HTML tradicionales
   - Implementa análisis de audio en tiempo real vía Web Audio API
   - Usa MutationObserver para detección de contenido dinámico

2. **Documento Offscreen** ([offscreen.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/offscreen.js:0:0-0:0)):

   - Maneja el procesamiento en modo enhanced
   - Usa la API tabCapture del navegador (basada en Chromium) para captura universal de audio
   - Procesa el stream de audio completo de la pestaña
   - Soporta servicios de streaming modernos

3. **Script de Fondo** ([background.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/background.js:0:0-0:0)):

   - Actúa como gestor centralizado de estado
   - Orquesta sesiones de captura de pestañas
   - Gestiona configuración y almacenamiento de la extensión
   - Calcula estadísticas de audio (EMA, picos)

4. **Interfaz Emergente** ([popup.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/popup.js:0:0-0:0), `popup.html`):
   - Proporciona controles de usuario
   - Muestra niveles de audio en tiempo real
   - Maneja el toggle de modo enhanced
   - Gestiona preferencias del usuario

## Componentes Principales

### Script de Contenido (Modo Normal)

- **Gestión de Contexto de Audio**: Crea y gestiona el contexto de la API Web Audio
- **Detección de Elementos**: Usa MutationObserver para contenido dinámico
- **Procesamiento de Audio**: Implementa cálculo RMS y control de ganancia
- **Manejo de Eventos**: Gestiona el ciclo de vida de los elementos de audio
- **Soporte Shadow DOM**: Escanea recursivamente shadow roots
- **Manejo de Gestos**: Reanuda AudioContext en interacción del usuario (política autoplay)

### Documento Offscreen (Modo Enhanced)

- **Captura de Pestaña**: Usa la API tabCapture del navegador (basada en Chromium) para acceso universal al audio
- **Procesamiento de Stream**: Procesa el stream de audio completo de la pestaña
- **Algoritmo Idéntico**: Misma lógica RMS y ganancia que el script de contenido
- **Compatibilidad de Servicios**: Funciona con streams MSE y Web Audio API
- **Gestión de Recursos**: Limpieza adecuada de streams multimedia y contextos de audio

### Script de Fondo

- **Gestión de Estado**: Pestañas, niveles de audio y configuraciones
- **Enrutamiento de Mensajes**: Maneja la comunicación entre componentes
- **Estadísticas**: Calcula promedios móviles exponenciales y picos
- **Almacenamiento**: la configuración por pestaña vive en `chrome.storage.local` y se elimina al cerrar la pestaña; cuando "Aplicar a todas las webs" está activo, el ajuste del limitador vive bajo una única clave global, persiste entre reinicios y se envía a todas las pestañas abiertas
- **Orquestación de Captura**: Gestiona el ciclo de vida del documento offscreen

### Interfaz Emergente

- **Medición en Tiempo Real**: Retroalimentación visual de niveles de audio
- **Configuración**: Interfaz de ajustes de usuario
- **Soporte de Temas**: Detección de modo claro/oscuro
- **Localización**: Soporte multiidioma vía la API i18n de extensiones del navegador (compatibles con Chromium)
- **Toggle Modo Enhanced**: Botón micrófono para activación manual

## Procesamiento de Audio

### Flujo de Señal

La limitación se ejecuta dentro de un **AudioWorklet** (`extension/js/limiter-processor.js`), en el hilo de renderizado de audio — ya no en un bucle `setInterval` del hilo principal. A diferencia de un simple "tap" de análisis, el worklet está directamente en el camino de la señal: lee la entrada, la retiene en un buffer unos milisegundos (lookahead), calcula la ganancia a partir de esa ventana retenida, y escribe el resultado ya ajustado en su propia salida. Cada camino sigue terminando en un `DynamicsCompressorNode`, mantenido solo como red de seguridad de último recurso.

**Modo Normal (Script de Contenido)**, cada elemento tiene su propio nodo limitador (audio independiente por elemento):

```
Elemento Media HTML → MediaElementSource → [AudioWorkletNode: limitador con lookahead] → DynamicsCompressor(seguridad) → Destino
```

**Modo Enhanced (Documento Offscreen)**:

```
Stream Audio Pestaña → MediaStreamSource → [AudioWorkletNode: limitador con lookahead] → DynamicsCompressor(seguridad) → Destino
```

### Limitador con Lookahead

Un limitador que solo reacciona *después* de ver una muestra fuerte siempre deja pasar esa muestra a volumen completo primero — de ahí la sensación de "suena fuerte y luego rápidamente se afloja". Para evitar de verdad que el audio suene por encima del techo, `extension/js/limiter-processor.js` implementa un **limitador brickwall con lookahead** (`LookaheadLimiter`):

1. El audio entrante se retiene en un buffer durante `LOOKAHEAD_BLOCKS` bloques de renderizado (~10.7ms @48kHz) antes de emitirse.
2. Para cada bloque retenido que aún espera ser emitido, el limitador ya conoce su pico por adelantado, así que puede calcular la ganancia necesaria para respetar el techo configurado en toda la ventana de lookahead.
3. El **ataque** es instantáneo: si se detecta un bloque más fuerte, la ganancia baja de inmediato — antes de que ese bloque se emita realmente — así nunca se pasa del techo.
4. La **recuperación** sube gradualmente (dB/seg, según el preset de fuerza) una vez que ya no queda ningún bloque más fuerte en la ventana.
5. La ganancia se interpola muestra a muestra dentro de cada bloque emitido (rampa lineal desde la última ganancia aplicada), así que no hay clics — y gracias al lookahead, el inicio y el final de esa rampa suelen estar ya muy cerca cuando el bloque fuerte se emite realmente.

Ver `LookaheadLimiter.process()` en `extension/js/limiter-processor.js` y su self-check en `tests/limiter-processor.test.js` (verifica que la salida literalmente nunca supera el techo, incluso justo en un pico repentino).

### Características Clave

- **Lookahead Real**: la reducción de ganancia se rampa antes de que un transitorio fuerte llegue a la salida, no después
- **Presets de recuperación**: Rápida / Normal / Lenta (`soft`/`normal`/`strong` = 15 / 8 / 4 dB/seg)
- **Compresor de Seguridad**: `DynamicsCompressorNode` nativo (umbral -3dB, ratio 20:1, ataque ~3ms) tras el limitador, como red de último recurso
- **Detección de Silencio**: ignora contenido en pausa/inaudible
- **Lectura de Reducción en Vivo**: el worklet reporta la reducción de ganancia aplicada al popup ~20 veces/seg

### Algoritmo de Ganancia

```javascript
// Para cada bloque entrante, se calcula la ganancia que necesitaría:
targetGain = min(1, ceilingLin / peak);

// La ganancia aplicada al bloque que está por emitirse ya tiene en cuenta
// cualquier bloque más fuerte que siga retenido por delante (la ventana de lookahead):
requiredGain = min(targetGain de cada bloque actualmente retenido);

if (requiredDB < currentDB) {
  activeGain = requiredGain;                                    // ATAQUE: instantáneo, sin overshoot
} else {
  activeGain = min(requiredGain, currentGain + releasePerBlock); // RECUPERACIÓN: gradual
}
```

### Consideraciones de Rendimiento

- **Procesamiento en el Hilo de Audio**: sin bucle de sondeo en el hilo principal; el worklet procesa cada bloque de 128 muestras in-place
- **Actualizaciones UI Limitadas**: el worklet reporta ganancia/dB al hilo principal ~20 veces/seg
- **Uso Mínimo de CPU**: Análisis optimizado con Float32Array
- **Gestión de Memoria**: `Set`/`WeakSet` para seguimiento de elementos/nodos
- **Límite de Historial**: 30 muestras para cálculo de promedio móvil

## Optimizaciones de Rendimiento

### Script de Contenido

- **Actualizaciones Limitadas**: Intervalo de procesamiento de 33ms
- **Inicialización Perezosa**: Recursos asignados bajo demanda
- **DOM Eficiente**: Mínima manipulación de elementos
- **Ejecución Segura**: Funciones wrapper para manejo de errores

### Procesamiento en Segundo Plano

- **Actualizaciones por Lotes**: Frecuencia de mensajes reducida
- **Eficiencia de Memoria**: Tamaño de historial limitado (30 muestras)
- **Carga Perezosa**: Recursos cargados cuando son necesarios
- **Operaciones Async**: APIs de extensiones del navegador promisificadas

### Renderizado de UI

- **Renderizado Limitado**: Límite de 60 FPS usando performance.now()
- **Actualizaciones con Debounce**: Menos reflows
- **Selectores Eficientes**: Referencias DOM en caché
- **Medidor con Colores**: Color dinámico basado en nivel dB

## Interfaz de Usuario

### Características

- Medidor de nivel en tiempo real con codificación de colores
- Techo configurable (-60 a 0 dBFS) con presets de recuperación Rápida/Normal/Lenta
- Lectura en vivo de la ganancia aplicada (reducción en dB), visible mientras está activo
- **Aplicar a todas las webs**: guarda el ajuste actual del limitador en `chrome.storage.local` y lo envía a todas las pestañas abiertas, así se mantiene activo en cualquier web/dominio que visites — no solo en la pestaña actual
- Interruptor de activación/desactivación
- Toggle de modo enhanced (botón micrófono)
- Tema oscuro estilo estudio
- Diseño responsivo
- Visualización de dB promedio con precisión de 1 decimal

### Accesibilidad

- Navegación por teclado
- Atributos ARIA
- Soporte para alto contraste
- Estructura HTML semántica

### Retroalimentación Visual

- **Verde**: Audio bajo el límite
- **Amarillo**: Audio acercándose al límite
- **Rojo**: Audio excediendo el límite (umbral -10 dBFS)

## Desafíos Técnicos

### Compatibilidad entre Navegadores

- **Objetivo**: Navegadores basados en Chromium (Edge, Opera, etc.)
- **APIs Requeridas**: Web Audio API, tabCapture, documentos offscreen
- **Manifest V3**: Usa arquitectura de service worker
- **Detección de Características**: Degradación elegante para características no soportadas

### Gestión de Recursos

- **Limpieza**: Eliminación adecuada de nodos de audio y streams
- **Fugas de Memoria**: WeakMaps/WeakSets para seguimiento de elementos
- **Rendimiento**: Manejo eficiente de eventos y throttling
- **Ciclo de Vida del Contexto**: Gestión adecuada del estado de AudioContext

### Casos Especiales

- **Contenido Dinámico**: Manejo de navegación en SPAs con MutationObserver
- **Múltiples Pestañas**: Procesamiento aislado por pestaña
- **Recuperación de Errores**: Degradación elegante ante fallos de API
- **Servicios de Streaming**: Modo enhanced automático para reproductores basados en MSE
- **Suspensión de AudioContext**: Se reanuda con gesto de usuario (política autoplay)
- **Reconexión de Elementos**: Previene errores de MediaElementSource duplicado

### Compatibilidad con Streaming Moderno

- **Media Source Extensions**: Modo enhanced evita limitaciones de elementos HTML
- **Medios Encriptados**: Funciona con contenido protegido por DRM vía captura de pestaña
- **Reproductores Personalizados**: Compatibilidad universal a través de captura a nivel de pestaña
- **Streams Web Audio API**: Maneja audio generado programáticamente
