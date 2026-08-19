/**
 * @file Offscreen document for tab audio capture and processing
 * @module OffscreenAudioProcessor
 */

/**
 * Handles tab-level audio capture and processing for enhanced mode.
 * Uses Chrome's tabCapture API to process audio from streaming services.
 *
 * The actual limiting (lookahead peak detection + gain) happens inside an
 * AudioWorklet (js/limiter-processor.js), sitting directly in the audio graph
 * on the audio rendering thread — not a main-thread setInterval loop feeding
 * a separate GainNode. A native DynamicsCompressorNode acts as a safety net
 * in case a fast transient still sneaks through.
 */
const SAFETY_COMPRESSOR = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });

class OffscreenAudioProcessor {
  constructor() {
    /** @type {AudioContext|null} - Web Audio API context */
    this.audioContext = null;

    /** @type {MediaStream|null} - Captured media stream from tab */
    this.mediaStream = null;

    /** @type {AudioWorkletNode|null} - Lookahead limiter node */
    this.limiterNode = null;

    /** @type {DynamicsCompressorNode|null} - Safety net after the limiter */
    this.safetyCompressor = null;

    /** @type {MediaStreamAudioSourceNode|null} - Audio source node */
    this.sourceNode = null;

    /** @type {boolean} - Processing state flag */
    this.isProcessing = false;

    /** @type {Object} - Limiter configuration */
    this.config = { enabled: false, limitDB: -20, limiterStrength: 'normal' };

    /** @type {number|null} - Current tab ID being processed */
    this.tabId = null;

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
            if (message.tabId == null || message.tabId === this.tabId) {
              this.stopCapture();
            }
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
      if (this.isProcessing || this.mediaStream || this.audioContext) {
        this.stopCapture();
      }

      this.tabId = tabId;

      // Obtain media stream using Chrome's tabCapture API
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
          },
        },
      });

      // Initialize Web Audio API context and processing nodes
      this.audioContext = new AudioContext();
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.safetyCompressor = this.audioContext.createDynamicsCompressor();
      Object.entries(SAFETY_COMPRESSOR).forEach(([k, v]) => { this.safetyCompressor[k].value = v; });

      await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('js/limiter-processor.js'));
      this.limiterNode = new AudioWorkletNode(this.audioContext, 'limiter-processor');
      this.limiterNode.port.onmessage = event => this.#handleMeter(event.data);

      // source → lookahead limiter (in-place) → safety compressor → destination
      this.sourceNode.connect(this.limiterNode);
      this.limiterNode.connect(this.safetyCompressor);
      this.safetyCompressor.connect(this.audioContext.destination);

      this.isProcessing = true;
      this.#postConfig();

      // Tab audio capture started successfully
    } catch (error) {
      console.error('Failed to start tab capture:', error);
      this.stopCapture();
      throw error;
    }
  }

  /**
   * Stops audio capture and cleans up all resources.
   */
  stopCapture() {
    this.isProcessing = false;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.sourceNode = null;
    this.limiterNode = null;
    this.safetyCompressor = null;
    this.tabId = null;
    // Tab audio capture stopped
  }

  /**
   * Updates the limiter configuration.
   * @param {Object} newConfig - New configuration object
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.#postConfig();
  }

  /**
   * Sends the current configuration to the limiter node, once it's ready.
   * @private
   */
  #postConfig() {
    if (!this.limiterNode) return;
    this.limiterNode.port.postMessage({ type: 'config', config: this.config });
  }

  /**
   * Forwards the decibel/gain reading reported by the limiter node to the background script.
   * The worklet already throttles its own reports (~40Hz); forwarding each one
   * keeps the popup's meter smooth.
   * @private
   * @param {{db: number, gain: number}} analysis
   */
  #handleMeter({ db, gain }) {
    this.sendDecibelUpdate(db, gain > 0 ? 20 * Math.log10(gain) : 0);
  }

  /**
   * Sends decibel level update to background script.
   * @param {number} db - Current decibel level
   * @param {number} gainDB - Currently applied gain, in dB
   */
  sendDecibelUpdate(db, gainDB = 0) {
    if (this.tabId != null) {
      chrome.runtime.sendMessage({
        type: 'updateDB',
        db: isFinite(db) ? db : -Infinity,
        gainDB,
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
