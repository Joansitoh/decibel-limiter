# Decibel Limiter - Technical Documentation / Limitador de Decibelios - Documentación Técnica

## English version

This document provides a comprehensive technical overview of how the Decibel Limiter browser extension works. It explains the architecture, key components, and audio processing techniques used to limit volume on web pages.

### Table of contents

1. [Architecture overview](#architecture-overview)
2. [Key components](#key-components)
3. [Audio processing](#audio-processing)
4. [User interface](#user-interface)
5. [Communication flow](#communication-flow)
6. [Special cases](#special-cases)
7. [Technical challenges](#technical-challenges)

## Architecture overview

The Decibel Limiter is built as a browser extension using the Chrome Extension Manifest V3 architecture. It consists of three main components:

1. **Content script (`content.js`)**: Runs in the context of web pages, detects audio/video elements, and applies volume limiting.
2. **Background script (`background.js`)**: Manages state across tabs and handles communication between components.
3. **Popup user interface (`popup.html`, `popup.js`)**: Provides the user interface for controlling limiter settings.

The extension uses the Web Audio API to analyze and modify audio in real-time without downloading or modifying the original media files.

## Key components

### Content script (`content.js`)

The content script is the core of the extension, responsible for:

- Setting up the Web Audio API context
- Finding and connecting to audio/video elements on the page
- Analyzing audio levels in real-time
- Applying gain reduction when audio exceeds the limit
- Handling special cases like Shadow DOM elements (for sites like Netflix)

### Background script (`background.js`)

The background script acts as a central coordinator:

- Stores per-tab configuration (enabled state, limit settings)
- Tracks audio levels across tabs
- Calculates statistics (current level, average, peak)
- Manages persistent storage of settings
- Handles communication between content scripts and popup

### Popup user interface (`popup.js`, `popup.html`)

The popup provides the user interface:

- Displays current audio levels with a meter
- Shows average audio level
- Allows adjustment of the limiting threshold
- Provides an on/off toggle
- Supports localization

## Audio processing

### Audio detection and connection

1. The content script searches for all `<audio>` and `<video>` elements on the page.
2. For each element, it creates a MediaElementSource and connects it to:
   - A GainNode for volume control
   - An AnalyserNode for level monitoring
   - The AudioContext destination (speakers)

3. For dynamically added elements, a MutationObserver watches for new media elements.
4. For elements in Shadow DOM (like on Netflix), a recursive search function finds and connects to them.

### Audio analysis

1. The `getRMS()` function calculates the Root Mean Square (RMS) amplitude of the audio signal:
   - Gets audio data from the AnalyserNode
   - Normalizes samples to [-1, 1] range
   - Calculates the RMS value
   - Only processes audio when media is actually playing (not paused)

2. The RMS value is converted to decibels (dBFS) using the formula: `20 * log10(rms)`

### Volume limiting

1. When audio exceeds the user-defined threshold:
   - The `globalGain` value is reduced to bring the level down to the threshold
   - The formula used is: `globalGain = limitRMS / rms`
   - A minimum gain of 0.01 (-40dB) is applied to avoid complete silence

2. When audio is below the threshold:
   - Gain gradually increases back toward 1.0 (full volume)
   - This creates a smooth release effect rather than abrupt volume changes

3. When the limiter is turned off:
   - All gain values are reset to 1.0 (full volume)
   - This ensures no volume reduction occurs when the extension is off

## User interface

The popup user interface provides real-time feedback and control:

1. **Meter display**:
   - Shows current audio level in real-time
   - Changes color based on level (blue for low, green for medium, red for high)
   - Scaled from -60dBFS to 0dBFS

2. **Average level display**:
   - Shows average audio level in dBFS
   - Provides a more stable reading than instantaneous level

3. **Limit slider control**:
   - Allows setting the threshold from -60dBFS to 0dBFS
   - Default value is -20dBFS (a reasonable level for most content)

4. **On/Off toggle**:
   - Enables or disables the limiter
   - When disabled, all audio returns to original volume

## Communication flow

1. **Content script to background**:
   - Sends current audio level measurements
   - Requests settings

2. **Background to popup**:
   - Sends current, average, and peak audio levels
   - Sends current configuration

3. **Popup to background**:
   - Sends configuration changes (limit threshold, enabled state)
   - Requests current audio statistics

4. **Background to content script**:
   - Sends updated configuration

All communication uses Chrome's messaging API with error handling for extension context invalidation.

## Special cases

### Netflix and shadow DOM

The extension includes special handling for websites that use Shadow DOM, particularly Netflix:

1. A recursive `searchInShadowDOM()` function traverses the Shadow DOM tree
2. For Netflix specifically, additional polling attempts are made to find video elements
3. The `applyGainToShadowDOM()` function ensures gain changes are applied to elements in Shadow DOM

### Handling already-connected elements

When a media element has already been connected to another AudioContext:

1. The extension catches the "already connected" error
2. Creates a gain node without attempting to create a new media element source
3. This allows the extension to work even when other extensions or the page itself are using the Web Audio API

### Paused media detection

To prevent false readings when media is paused:

1. The `getRMS()` function checks if any media element is actually playing
2. If all media is paused, it returns 0 (which converts to -Infinity dB)
3. This prevents the meter from showing activity when no audio is playing

## Technical challenges

### Cross-browser compatibility

The Web Audio API implementation may vary slightly between browsers. The extension is designed to work primarily with Chromium-based browsers (Chrome, Edge, Opera).

### Performance considerations

Audio processing is performed in real-time, requiring efficient code:

1. Analysis uses a reasonable FFT size (2048) for good resolution without excessive CPU usage
2. The update loop uses requestAnimationFrame for efficient rendering
3. Error handling prevents crashes if the extension context is invalidated

### Extension context invalidation

When the extension is updated or reloaded, the context may be invalidated. The code includes multiple checks to detect this and gracefully stop processing to avoid errors.

### Multiple media elements

When multiple audio/video elements are playing simultaneously:

1. Each element gets its own gain node
2. The same global gain value is applied to all elements
3. This ensures consistent volume limiting across all media on the page

---

## Versión en español

Este documento proporciona una visión técnica completa del funcionamiento de la extensión Limitador de Decibelios para navegadores. Explica la arquitectura, los componentes clave y las técnicas de procesamiento de audio utilizadas para limitar el volumen en las páginas web.

### Índice

1. [Visión general de la arquitectura](#visión-general-de-la-arquitectura)
2. [Componentes clave](#componentes-clave)
3. [Procesamiento de audio](#procesamiento-de-audio)
4. [Interfaz de usuario](#interfaz-de-usuario)
5. [Flujo de comunicación](#flujo-de-comunicación)
6. [Casos especiales](#casos-especiales)
7. [Desafíos técnicos](#desafíos-técnicos)

## Visión general de la arquitectura

El Limitador de Decibelios está construido como una extensión de navegador utilizando la arquitectura Chrome Extension Manifest V3. Consta de tres componentes principales:

1. **Script de contenido (`content.js`)**: Se ejecuta en el contexto de las páginas web, detecta elementos de audio/video y aplica la limitación de volumen.
2. **Script de fondo (`background.js`)**: Gestiona el estado entre pestañas y maneja la comunicación entre componentes.
3. **Interfaz de usuario emergente (`popup.html`, `popup.js`)**: Proporciona la interfaz de usuario para controlar la configuración del limitador.

La extensión utiliza la API Web Audio para analizar y modificar el audio en tiempo real sin descargar ni modificar los archivos multimedia originales.

## Componentes clave

### Script de contenido (`content.js`)

El script de contenido es el núcleo de la extensión, responsable de:

- Configurar el contexto de la API Web Audio
- Encontrar y conectarse a elementos de audio/video en la página
- Analizar los niveles de audio en tiempo real
- Aplicar reducción de ganancia cuando el audio excede el límite
- Manejar casos especiales como elementos Shadow DOM (para sitios como Netflix)

### Script de fondo (`background.js`)

El script de fondo actúa como un coordinador central:

- Almacena la configuración por pestaña (estado habilitado, configuración de límites)
- Rastrea los niveles de audio entre pestañas
- Calcula estadísticas (nivel actual, promedio, pico)
- Gestiona el almacenamiento persistente de configuraciones
- Maneja la comunicación entre scripts de contenido y la ventana emergente

### Interfaz de usuario emergente (`popup.js`, `popup.html`)

La ventana emergente proporciona la interfaz de usuario:

- Muestra los niveles de audio actuales con un medidor
- Muestra el nivel de audio promedio
- Permite ajustar el umbral de limitación
- Proporciona un interruptor de activación/desactivación
- Soporta localización

## Procesamiento de audio

### Detección y conexión de audio

1. El script de contenido busca todos los elementos `<audio>` y `<video>` en la página.
2. Para cada elemento, crea un MediaElementSource y lo conecta a:
   - Un GainNode para el control de volumen
   - Un AnalyserNode para el monitoreo de nivel
   - El destino AudioContext (altavoces)

3. Para elementos añadidos dinámicamente, un MutationObserver vigila nuevos elementos multimedia.
4. Para elementos en Shadow DOM (como en Netflix), una función de búsqueda recursiva los encuentra y se conecta a ellos.

### Análisis de audio

1. La función `getRMS()` calcula la amplitud Root Mean Square (RMS) de la señal de audio:
   - Obtiene datos de audio del AnalyserNode
   - Normaliza las muestras al rango [-1, 1]
   - Calcula el valor RMS
   - Solo procesa audio cuando los medios están realmente reproduciéndose (no en pausa)

2. El valor RMS se convierte a decibelios (dBFS) usando la fórmula: `20 * log10(rms)`

### Limitación de volumen

1. Cuando el audio excede el umbral definido por el usuario:
   - El valor `globalGain` se reduce para bajar el nivel hasta el umbral
   - La fórmula utilizada es: `globalGain = limitRMS / rms`
   - Se aplica una ganancia mínima de 0.01 (-40dB) para evitar el silencio completo

2. Cuando el audio está por debajo del umbral:
   - La ganancia aumenta gradualmente de nuevo hacia 1.0 (volumen completo)
   - Esto crea un efecto de liberación suave en lugar de cambios bruscos de volumen

3. Cuando el limitador está desactivado:
   - Todos los valores de ganancia se restablecen a 1.0 (volumen completo)
   - Esto asegura que no se produzca reducción de volumen cuando la extensión está apagada

## Interfaz de usuario

La interfaz de usuario emergente proporciona retroalimentación y control en tiempo real:

1. **Visualización del medidor**:
   - Muestra el nivel de audio actual en tiempo real
   - Cambia de color según el nivel (azul para bajo, verde para medio, rojo para alto)
   - Escalado de -60dBFS a 0dBFS

2. **Visualización de nivel promedio**:
   - Muestra el nivel de audio promedio en dBFS
   - Proporciona una lectura más estable que el nivel instantáneo

3. **Control deslizante de límite**:
   - Permite establecer el umbral desde -60dBFS hasta 0dBFS
   - El valor predeterminado es -20dBFS (un nivel razonable para la mayoría del contenido)

4. **Interruptor de activación/desactivación**:
   - Activa o desactiva el limitador
   - Cuando está desactivado, todo el audio vuelve al volumen original

## Flujo de comunicación

1. **Script de contenido a fondo**:
   - Envía mediciones de nivel de audio actuales
   - Solicita configuraciones

2. **Fondo a ventana emergente**:
   - Envía niveles de audio actuales, promedio y pico
   - Envía configuración actual

3. **Ventana emergente a fondo**:
   - Envía cambios de configuración (umbral límite, estado habilitado)
   - Solicita estadísticas de audio actuales

4. **Fondo a script de contenido**:
   - Envía configuración actualizada

Toda la comunicación utiliza la API de mensajería de Chrome con manejo de errores para la invalidación del contexto de extensión.

## Casos especiales

### Netflix y shadow DOM

La extensión incluye manejo especial para sitios web que utilizan Shadow DOM, particularmente Netflix:

1. Una función recursiva `searchInShadowDOM()` recorre el árbol Shadow DOM
2. Para Netflix específicamente, se realizan intentos adicionales de sondeo para encontrar elementos de video
3. La función `applyGainToShadowDOM()` asegura que los cambios de ganancia se apliquen a elementos en Shadow DOM

### Manejo de elementos ya conectados

Cuando un elemento multimedia ya ha sido conectado a otro AudioContext:

1. La extensión captura el error "already connected" (ya conectado)
2. Crea un nodo de ganancia sin intentar crear una nueva fuente de elemento multimedia
3. Esto permite que la extensión funcione incluso cuando otras extensiones o la propia página están utilizando la API Web Audio

### Detección de medios en pausa

Para prevenir lecturas falsas cuando los medios están en pausa:

1. La función `getRMS()` verifica si algún elemento multimedia está realmente reproduciéndose
2. Si todos los medios están en pausa, devuelve 0 (que se convierte a -Infinity dB)
3. Esto evita que el medidor muestre actividad cuando no se está reproduciendo audio

## Desafíos técnicos

### Compatibilidad entre navegadores

La implementación de la API Web Audio puede variar ligeramente entre navegadores. La extensión está diseñada para funcionar principalmente con navegadores basados en Chromium (Chrome, Edge, Opera).

### Consideraciones de rendimiento

El procesamiento de audio se realiza en tiempo real, lo que requiere código eficiente:

1. El análisis utiliza un tamaño FFT razonable (2048) para una buena resolución sin uso excesivo de CPU
2. El bucle de actualización utiliza requestAnimationFrame para una renderización eficiente
3. El manejo de errores evita bloqueos si el contexto de la extensión se invalida

### Invalidación del contexto de extensión

Cuando la extensión se actualiza o recarga, el contexto puede invalidarse. El código incluye múltiples verificaciones para detectar esto y detener el procesamiento de manera elegante para evitar errores.

### Múltiples elementos multimedia

Cuando se reproducen simultáneamente múltiples elementos de audio/video:

1. Cada elemento obtiene su propio nodo de ganancia
2. El mismo valor de ganancia global se aplica a todos los elementos
3. Esto asegura una limitación de volumen consistente en todos los medios de la página
