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

### Processing Modes

- **Normal Mode**: For traditional HTML audio/video elements (YouTube, Netflix)
- **Enhanced Mode**: For modern streaming services using MSE/Web Audio API (Disney+, Hulu, SoundCloud)

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
- **Storage**: Manages persistent settings with browser storage APIs (Chromium-compatible)
- **Tab Capture Orchestration**: Manages offscreen document lifecycle

### Popup UI

- **Real-time Metering**: Visual feedback of audio levels
- **Configuration**: User settings interface
- **Theme Support**: Light/dark mode detection
- **Localization**: Multi-language support via the extensions i18n API (Chromium-compatible)
- **Enhanced Mode Toggle**: Microphone button for manual activation

## Audio Processing

### Signal Flow

**Normal Mode (Content Script)**:

```
HTML Media Element → MediaElementSource → [Analyser] → Destination
                                      → [GainNode] → Destination
```

**Enhanced Mode (Offscreen Document)**:

```
Tab Audio Stream → MediaStreamSource → Analyser → GainNode → Destination
```

### Key Features

- **RMS Calculation**: Root Mean Square for accurate level metering (2048 FFT size)
- **Exponential Moving Average**: EMA with alpha=0.3 for smooth display
- **Dynamic Gain Control**: Automatic volume adjustment with gradual restoration
- **Silence Detection**: Ignores paused/inaudible content
- **Zero Smoothing**: `analyser.smoothingTimeConstant = 0` for accurate readings

### Gain Algorithm

```javascript
if (rms > limitRms) {
  gain = max(0.01, limitRms / rms); // Immediate reduction
} else {
  gain = min(1, currentGain * 1.01); // Gradual restoration
}
```

### Performance Considerations

- **Efficient Updates**: 30 FPS processing (~33ms interval)
- **Throttled UI Updates**: 20 FPS for decibel display (~50ms)
- **Minimal CPU Usage**: Optimized Float32Array analysis
- **Memory Management**: WeakMaps/WeakSets for element tracking
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
- Configurable threshold (-60 to 0 dBFS)
- Enable/disable toggle
- Enhanced mode toggle (mic button)
- Theme support (light/dark)
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
- **Almacenamiento**: Gestiona configuraciones persistentes con APIs de almacenamiento del navegador (compatibles con Chromium)
- **Orquestación de Captura**: Gestiona el ciclo de vida del documento offscreen

### Interfaz Emergente

- **Medición en Tiempo Real**: Retroalimentación visual de niveles de audio
- **Configuración**: Interfaz de ajustes de usuario
- **Soporte de Temas**: Detección de modo claro/oscuro
- **Localización**: Soporte multiidioma vía la API i18n de extensiones del navegador (compatibles con Chromium)
- **Toggle Modo Enhanced**: Botón micrófono para activación manual

## Procesamiento de Audio

### Flujo de Señal

**Modo Normal (Script de Contenido)**:

```
Elemento Media HTML → MediaElementSource → [Analyser] → Destino
                                       → [GainNode] → Destino
```

**Modo Enhanced (Documento Offscreen)**:

```
Stream Audio Pestaña → MediaStreamSource → Analyser → GainNode → Destino
```

### Características Clave

- **Cálculo RMS**: Medición precisa de niveles (tamaño FFT 2048)
- **Promedio Móvil Exponencial**: EMA con alpha=0.3 para visualización suave
- **Control Dinámico de Ganancia**: Ajuste automático con restauración gradual
- **Detección de Silencio**: Ignora contenido en pausa/inaudible
- **Sin Suavizado**: `analyser.smoothingTimeConstant = 0` para lecturas precisas

### Algoritmo de Ganancia

```javascript
if (rms > limitRms) {
  gain = max(0.01, limitRms / rms); // Reducción inmediata
} else {
  gain = min(1, currentGain * 1.01); // Restauración gradual
}
```

### Consideraciones de Rendimiento

- **Actualizaciones Eficientes**: Procesamiento a 30 FPS (intervalo ~33ms)
- **Actualizaciones UI Limitadas**: 20 FPS para visualización de decibelios (~50ms)
- **Uso Mínimo de CPU**: Análisis optimizado con Float32Array
- **Gestión de Memoria**: WeakMaps/WeakSets para seguimiento de elementos
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
- Umbral configurable (-60 a 0 dBFS)
- Interruptor de activación/desactivación
- Toggle de modo enhanced (botón micrófono)
- Soporte de temas (claro/oscuro)
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
