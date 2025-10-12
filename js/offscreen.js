/**
 * @file Offscreen document for tab audio capture and processing
 * @module OffscreenAudioProcessor
 */

/**
 * Handles tab-level audio capture and processing for enhanced mode.
 * Uses Chrome's tabCapture API to process audio from streaming services.
 */
class OffscreenAudioProcessor {
  constructor() {
    /** @type {AudioContext|null} - Web Audio API context */
    this.audioContext = null;
    
    /** @type {MediaStream|null} - Captured media stream from tab */
    this.mediaStream = null;
    
    /** @type {AnalyserNode|null} - Audio analyser for RMS calculation */
    this.analyser = null;
    
    /** @type {GainNode|null} - Gain node for volume limiting */
    this.gainNode = null;
    
    /** @type {MediaStreamAudioSourceNode|null} - Audio source node */
    this.sourceNode = null;
    
    /** @type {boolean} - Processing state flag */
    this.isProcessing = false;
    
    /** @type {{enabled: boolean, limitDB: number}} - Limiter configuration */
    this.config = { enabled: false, limitDB: -20 };
    
    /** @type {number|null} - Current tab ID being processed */
    this.tabId = null;

    /** @type {number|null} - Interval ID for audio processing loop */
    this.processingInterval = null;
    
    /** @type {number} - Timestamp of last decibel update sent */
    this.lastSendTime = 0;

    /** @type {number} - Current gain reduction value for smooth transitions */
    this.currentGain = 1.0;

    this.setupMessageListener();
  }

  /**
   * Sets up message listener for communication with background script.
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      try {
        switch (message.type) {
          case 'start-capture':
            await this.startCapture(message.streamId, message.tabId);
            sendResponse({ success: true });
            break;
          case 'stop-capture':
            this.stopCapture();
            sendResponse({ success: true });
            break;
          case 'update-config':
            this.updateConfig(message.config);
            sendResponse({ success: true });
            break;
          case 'get-status':
            sendResponse({
              isProcessing: this.isProcessing,
              hasAudio: !!this.mediaStream
            });
            break;
        }
      } catch (error) {
        console.error('Offscreen message handler error:', error);
        sendResponse({ error: error.message });
      }
      return true;
    });
  }

  /**
   * Starts audio capture from a tab using the provided stream ID.
   * @param {string} streamId - Chrome tab capture stream ID
   * @param {number} tabId - Tab ID to capture audio from
   * @returns {Promise<void>}
   * @throws {Error} If capture fails to start
   */
  async startCapture(streamId, tabId) {
    try {
      this.tabId = tabId;

      // Obtain media stream using Chrome's tabCapture API
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
          },
        },
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
          },
        },
      });

      // Initialize Web Audio API context and processing nodes
      this.audioContext = new AudioContext();
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.gainNode = this.audioContext.createGain();

      // Configure analyser for accurate peak detection
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0; // No smoothing for accurate RMS

      // Connect audio graph: source -> analyser -> gain -> destination
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Start processing
      this.isProcessing = true;
      this.startProcessingLoop();

      // Tab audio capture started successfully
    } catch (error) {
      console.error('Failed to start tab capture:', error);
      throw error;
    }
  }

  /**
   * Stops audio capture and cleans up all resources.
   */
  stopCapture() {
    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.sourceNode = null;
    this.analyser = null;
    this.gainNode = null;
    this.tabId = null;
    this.currentGain = 1.0;
    // Tab audio capture stopped
  }

  /**
   * Updates the limiter configuration.
   * @param {Object} newConfig - New configuration object
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Starts the audio processing loop at approximately 30 FPS.
   */
  startProcessingLoop() {
    // Process audio at ~30 FPS for smooth limiting
    this.processingInterval = setInterval(() => {
      if (!this.isProcessing || !this.analyser || !this.gainNode) return;

      this.processAudio();
    }, 33); // ~30 FPS
  }

  /**
   * Processes audio data: calculates RMS, applies gain limiting, and sends updates.
   * Uses professional attack/release times for smooth, perceptible limiting.
   */
  processAudio() {
    try {
      // Extract time-domain audio data from analyser
      const bufferLength = this.analyser.fftSize;
      const dataArray = new Float32Array(bufferLength);
      this.analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square) for volume level
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / bufferLength);

      // Convert RMS to decibels (dBFS)
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

      // Apply gain limiting with professional attack/release characteristics
      let targetGain = 1.0;
      
      if (this.config.enabled && isFinite(db)) {
        const limitRms = Math.pow(10, this.config.limitDB / 20);
        
        if (rms > limitRms) {
          // ATTACK: Audio exceeds limit - reduce gain immediately (fast attack)
          targetGain = Math.max(0.01, limitRms / rms);
          // Apply immediately for instant limiting
          this.currentGain = targetGain;
        } else {
          // RELEASE: Audio under limit - restore gain gradually
          // Release time: ~100ms for perceptible but smooth recovery
          // At 30 FPS (33ms per frame), increment by ~3% per frame
          const releaseIncrement = 1.03;
          targetGain = Math.min(1.0, this.currentGain * releaseIncrement);
          this.currentGain = targetGain;
        }
      } else {
        // Limiting disabled - restore to unity gain quickly
        this.currentGain = 1.0;
        targetGain = 1.0;
      }

      // Apply calculated gain directly for immediate response
      this.gainNode.gain.value = targetGain;

      // Send decibel updates to background (throttled to 20 FPS)
      const now = performance.now();
      if (now - this.lastSendTime > 50) { // 20 FPS for UI updates
        this.lastSendTime = now;
        this.sendDecibelUpdate(db);
      }

    } catch (error) {
      console.error('Audio processing error:', error);
    }
  }

  /**
   * Sends decibel level update to background script.
   * @param {number} db - Current decibel level
   */
  sendDecibelUpdate(db) {
    if (this.tabId) {
      chrome.runtime.sendMessage({
        type: 'updateDB',
        db: isFinite(db) ? db : -Infinity,
        tabId: this.tabId,
        source: 'offscreen'
      }).catch(error => {
        // Ignore errors when popup is closed
        if (!error.message.includes('Receiving end does not exist')) {
          console.error('Failed to send decibel update:', error);
        }
      });
    }
  }
}

// Initialize the offscreen audio processor instance
const processor = new OffscreenAudioProcessor();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  processor.stopCapture();
});
