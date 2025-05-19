# Decibel Limiter - Technical Documentation / Limitador de Decibelios - Documentación Técnica

## English Version

### Overview
The Decibel Limiter is a lightweight browser extension that monitors and controls audio levels in real-time across web pages. It's built with modern web technologies and optimized for performance.

### Table of Contents
1. [Architecture](#architecture)
2. [Core Components](#core-components)
3. [Audio Processing](#audio-processing)
4. [Performance Optimizations](#performance-optimizations)
5. [User Interface](#user-interface)
6. [Technical Challenges](#technical-challenges)

## Architecture

The extension follows a modular architecture with three main components:

1. **Content Script** ([content.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/content.js:0:0-0:0)):
   - Runs in the context of web pages
   - Handles audio element detection and processing
   - Implements real-time audio analysis
   - Manages Web Audio API nodes

2. **Background Script** ([background.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/background.js:0:0-0:0)):
   - Acts as a centralized state manager
   - Handles cross-tab communication
   - Manages extension settings
   - Calculates audio statistics

3. **Popup UI** ([popup.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/popup.js:0:0-0:0), `popup.html`):
   - Provides user controls
   - Displays real-time audio levels
   - Handles user preferences

## Core Components

### Content Script
- **Audio Context Management**: Creates and manages Web Audio API context
- **Element Detection**: Uses MutationObserver for dynamic content
- **Audio Processing**: Implements RMS calculation and gain control
- **Event Handling**: Manages audio element lifecycle

### Background Script
- **State Management**: Tabs, audio levels, and settings
- **Message Routing**: Handles communication between components
- **Statistics**: Calculates moving averages and peaks
- **Storage**: Manages persistent settings

### Popup UI
- **Real-time Metering**: Visual feedback of audio levels
- **Configuration**: User settings interface
- **Theme Support**: Light/dark mode
- **Localization**: Multi-language support

## Audio Processing

### Signal Flow
1. Audio source (media element) → MediaElementSource → GainNode → AnalyserNode → Destination

### Key Features
- **RMS Calculation**: Root Mean Square for accurate level metering
- **Exponential Moving Average**: Smooth level display
- **Dynamic Gain Control**: Automatic volume adjustment
- **Silence Detection**: Ignores paused/inaudible content

### Performance Considerations
- **Efficient Updates**: 30 FPS processing
- **Minimal CPU Usage**: Optimized analysis
- **Memory Management**: WeakMaps for element tracking

## Performance Optimizations

### Content Script
- **Throttled Updates**: 33ms processing interval
- **Lazy Initialization**: Resources allocated on demand
- **Efficient DOM**: Minimal element manipulation

### Background Processing
- **Batched Updates**: Reduced message frequency
- **Memory Efficiency**: Limited history size (30 samples)
- **Lazy Loading**: Resources loaded when needed

### UI Rendering
- **requestAnimationFrame**: Smooth animations
- **Debounced Updates**: Reduced reflows
- **Efficient Selectors**: Cached DOM references

## User Interface

### Features
- Real-time level meter
- Configurable threshold
- Enable/disable toggle
- Theme support
- Responsive design

### Accessibility
- Keyboard navigation
- ARIA attributes
- High contrast support

## Technical Challenges

### Cross-Browser Compatibility
- **Target**: Chromium-based browsers (Chrome, Edge, Opera)
- **Feature Detection**: Graceful degradation
- **API Consistency**: Web Audio API variations

### Resource Management
- **Cleanup**: Proper disposal of audio nodes
- **Memory Leaks**: WeakMaps for element tracking
- **Performance**: Efficient event handling

### Edge Cases
- **Dynamic Content**: Handles SPA navigation
- **Multiple Tabs**: Isolated processing
- **Error Recovery**: Graceful degradation

---

## Versión en Español

### Visión General
El Limitador de Decibelios es una extensión ligera para navegadores que monitorea y controla los niveles de audio en tiempo real en páginas web. Está construida con tecnologías web modernas y optimizada para rendimiento.

### Tabla de Contenidos
1. [Arquitectura](#arquitectura)
2. [Componentes Principales](#componentes-principales)
3. [Procesamiento de Audio](#procesamiento-de-audio)
4. [Optimizaciones de Rendimiento](#optimizaciones-de-rendimiento)
5. [Interfaz de Usuario](#interfaz-de-usuario)
6. [Desafíos Técnicos](#desafíos-técnicos)

## Arquitectura

La extensión sigue una arquitectura modular con tres componentes principales:

1. **Script de Contenido** ([content.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/content.js:0:0-0:0)):
   - Se ejecuta en el contexto de las páginas web
   - Detecta y procesa elementos de audio
   - Implementa análisis de audio en tiempo real
   - Gestiona nodos de la API Web Audio

2. **Script de Fondo** ([background.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/background.js:0:0-0:0)):
   - Actúa como gestor centralizado de estado
   - Maneja la comunicación entre pestañas
   - Gestiona la configuración de la extensión
   - Calcula estadísticas de audio

3. **Interfaz Emergente** ([popup.js](cci:7://file:///c:/Users/joans/Sources/decibel-limiter/js/popup.js:0:0-0:0), `popup.html`):
   - Proporciona controles de usuario
   - Muestra niveles de audio en tiempo real
   - Maneja preferencias del usuario

## Componentes Principales

### Script de Contenido
- **Gestión de Contexto de Audio**: Crea y gestiona el contexto de la API Web Audio
- **Detección de Elementos**: Usa MutationObserver para contenido dinámico
- **Procesamiento de Audio**: Implementa cálculo RMS y control de ganancia
- **Manejo de Eventos**: Gestiona el ciclo de vida de los elementos de audio

### Script de Fondo
- **Gestión de Estado**: Pestañas, niveles de audio y configuraciones
- **Enrutamiento de Mensajes**: Maneja la comunicación entre componentes
- **Estadísticas**: Calcula promedios móviles y picos
- **Almacenamiento**: Gestiona configuraciones persistentes

### Interfaz Emergente
- **Medición en Tiempo Real**: Retroalimentación visual de niveles de audio
- **Configuración**: Interfaz de ajustes de usuario
- **Soporte de Temas**: Modo claro/oscuro
- **Localización**: Soporte para múltiples idiomas

## Procesamiento de Audio

### Flujo de Señal
1. Fuente de audio (elemento multimedia) → MediaElementSource → GainNode → AnalyserNode → Salida

### Características Clave
- **Cálculo RMS**: Para medición precisa de niveles
- **Promedio Móvil Exponencial**: Visualización suave de niveles
- **Control Dinámico de Ganancia**: Ajuste automático de volumen
- **Detección de Silencio**: Ignora contenido en pausa/inaudible

### Consideraciones de Rendimiento
- **Actualizaciones Eficientes**: Procesamiento a 30 FPS
- **Uso Mínimo de CPU**: Análisis optimizado
- **Gestión de Memoria**: Uso de WeakMaps para seguimiento de elementos

## Optimizaciones de Rendimiento

### Script de Contenido
- **Actualizaciones Limitadas**: Intervalo de procesamiento de 33ms
- **Inicialización Pausada**: Recursos asignados bajo demanda
- **DOM Eficiente**: Mínima manipulación de elementos

### Procesamiento en Segundo Plano
- **Actualizaciones por Lotes**: Frecuencia de mensajes reducida
- **Eficiencia de Memoria**: Tamaño de historial limitado (30 muestras)
- **Carga Pausada**: Recursos cargados cuando son necesarios

### Renderizado de UI
- **requestAnimationFrame**: Animaciones fluidas
- **Actualizaciones con Debounce**: Menos reflows
- **Selectores Eficientes**: Referencias DOM en caché

## Interfaz de Usuario

### Características
- Medidor de nivel en tiempo real
- Umbral configurable
- Interruptor de activación/desactivación
- Soporte de temas
- Diseño responsivo

### Accesibilidad
- Navegación por teclado
- Atributos ARIA
- Soporte para alto contraste

## Desafíos Técnicos

### Compatibilidad entre Navegadores
- **Objetivo**: Navegadores basados en Chromium (Chrome, Edge, Opera)
- **Detección de Características**: Degradación elegante
- **Consistencia de API**: Variaciones en la API Web Audio

### Gestión de Recursos
- **Limpieza**: Eliminación adecuada de nodos de audio
- **Fugas de Memoria**: Uso de WeakMaps para seguimiento de elementos
- **Rendimiento**: Manejo eficiente de eventos

### Casos Especiales
- **Contenido Dinámico**: Manejo de navegación en SPAs
- **Múltiples Pestañas**: Procesamiento aislado
- **Recuperación de Errores**: Degradación elegante