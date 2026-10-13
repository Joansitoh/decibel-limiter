/**
 * @file Offscreen document — Best quality (tabCapture) path
 * @module OffscreenAudioProcessor
 */

const SAFETY_COMPRESSOR = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });

const LEVELING_PROFILES = Object.freeze({
  night: { threshold: -35, knee: 6, ratio: 8, attack: 0.005, release: 0.5, makeup: 1.5 },
  balanced: { threshold: -28, knee: 12, ratio: 4, attack: 0.02, release: 0.3, makeup: 1.2 },
  social: { threshold: -45, knee: 4, ratio: 12, attack: 0.003, release: 0.2, makeup: 2.2 }
});

class OffscreenAudioProcessor {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.limiterNode = null;
    this.levelingCompressor = null;
    this.makeupGain = null;
    this.safetyCompressor = null;
    this.sourceNode = null;
    this.isProcessing = false;
    this.config = {
      enabled: false,
      limitDB: -20,
      limiterStrength: 'normal',
      levelingEnabled: false,
      levelingProfile: null
    };
    this.tabId = null;
    this.setupMessageListener();
  }

  setupMessageListener() {
    // Must return true *synchronously* so sendResponse stays valid after awaits.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      (async () => {
        try {
          switch (message.type) {
            case 'start-capture':
              await this.startCapture(message.streamId, message.tabId, message.config);
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
              sendResponse({ isProcessing: this.isProcessing, hasAudio: !!this.mediaStream });
              break;
            default:
              break;
          }
        } catch (error) {
          console.error('Offscreen message handler error:', error);
          sendResponse({ error: error.message || String(error) });
        }
      })();
      return true;
    });
  }

  async startCapture(streamId, tabId, config) {
    try {
      if (this.isProcessing || this.mediaStream || this.audioContext) {
        this.stopCapture();
      }

      this.tabId = tabId;
      if (config && typeof config === 'object') {
        this.config = { ...this.config, ...config };
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        }
      });

      this.audioContext = new AudioContext();
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      this.levelingCompressor = this.audioContext.createDynamicsCompressor();
      this.makeupGain = this.audioContext.createGain();
      this.safetyCompressor = this.audioContext.createDynamicsCompressor();
      Object.entries(SAFETY_COMPRESSOR).forEach(([k, v]) => { this.safetyCompressor[k].value = v; });

      await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('js/limiter-processor.js'));
      this.limiterNode = new AudioWorkletNode(this.audioContext, 'limiter-processor');
      this.limiterNode.port.onmessage = event => this.#handleMeter(event.data);

      // source → leveling → makeup → lookahead → safety → dest
      this.sourceNode.connect(this.levelingCompressor);
      this.levelingCompressor.connect(this.makeupGain);
      this.makeupGain.connect(this.limiterNode);
      this.limiterNode.connect(this.safetyCompressor);
      this.safetyCompressor.connect(this.audioContext.destination);

      this.isProcessing = true;
      this.#postConfig();
      this.#applyLeveling();
    } catch (error) {
      console.error('Failed to start tab capture:', error);
      this.stopCapture();
      throw error;
    }
  }

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
    this.levelingCompressor = null;
    this.makeupGain = null;
    this.safetyCompressor = null;
    this.tabId = null;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.#postConfig();
    this.#applyLeveling();
  }

  #applyLeveling() {
    if (!this.levelingCompressor || !this.makeupGain) return;
    const profile = this.config.levelingEnabled
      ? LEVELING_PROFILES[this.config.levelingProfile]
      : null;
    if (!profile) {
      this.levelingCompressor.threshold.value = 0;
      this.levelingCompressor.ratio.value = 1;
      this.makeupGain.gain.value = 1;
      return;
    }
    this.levelingCompressor.threshold.value = profile.threshold;
    this.levelingCompressor.knee.value = profile.knee;
    this.levelingCompressor.ratio.value = profile.ratio;
    this.levelingCompressor.attack.value = profile.attack;
    this.levelingCompressor.release.value = profile.release;
    this.makeupGain.gain.value = profile.makeup;
  }

  #postConfig() {
    if (!this.limiterNode) return;
    this.limiterNode.port.postMessage({ type: 'config', config: this.config });
  }

  #handleMeter({ db, gain }) {
    this.sendDecibelUpdate(db, gain > 0 ? 20 * Math.log10(gain) : 0);
  }

  sendDecibelUpdate(db, gainDB = 0) {
    if (this.tabId != null) {
      chrome.runtime.sendMessage({
        type: 'updateDB',
        db: isFinite(db) ? db : -Infinity,
        gainDB,
        tabId: this.tabId,
        source: 'offscreen'
      }).catch(error => {
        if (!error.message?.includes('Receiving end does not exist')) {
          console.error('Failed to send decibel update:', error);
        }
      });
    }
  }
}

const processor = new OffscreenAudioProcessor();
window.addEventListener('beforeunload', () => { processor.stopCapture(); });
