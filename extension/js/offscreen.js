/**
 * @file Offscreen document — Best quality (tabCapture) path
 * Loaded after presets.js (see offscreen.html).
 * @module OffscreenAudioProcessor
 */

const { SAFETY_COMPRESSOR, applyLeveling, levelingProfileFor } = self.DLPresets;

const HANDLED = new Set(['start-capture', 'stop-capture', 'update-config']);

class OffscreenAudioProcessor {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.limiterNode = null;
    this.levelingCompressor = null;
    this.makeupGain = null;
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
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // Ignore other extension traffic (updateDB, pageReady…) so their senders aren't left hanging.
      if (!HANDLED.has(message.type)) return;
      (async () => {
        try {
          switch (message.type) {
            case 'start-capture':
              await this.startCapture(message.streamId, message.tabId, message.config);
              break;
            case 'stop-capture':
              if (message.tabId == null || message.tabId === this.tabId) this.stopCapture();
              break;
            case 'update-config':
              this.updateConfig(message.config);
              break;
          }
          sendResponse({ success: true });
        } catch (error) {
          console.error('Offscreen message handler error:', error);
          sendResponse({ error: error.message || String(error) });
        }
      })();
      // Must return true *synchronously* so sendResponse stays valid after awaits.
      return true;
    });
  }

  async startCapture(streamId, tabId, config) {
    try {
      if (this.mediaStream || this.audioContext) this.stopCapture();

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
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      this.levelingCompressor = this.audioContext.createDynamicsCompressor();
      this.makeupGain = this.audioContext.createGain();
      const safety = this.audioContext.createDynamicsCompressor();
      Object.entries(SAFETY_COMPRESSOR).forEach(([k, v]) => { safety[k].value = v; });

      await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('js/limiter-processor.js'));
      this.limiterNode = new AudioWorkletNode(this.audioContext, 'limiter-processor');
      this.limiterNode.port.onmessage = event => this.#handleMeter(event.data);

      // source → leveling → makeup → lookahead → safety → dest
      source.connect(this.levelingCompressor);
      this.levelingCompressor.connect(this.makeupGain);
      this.makeupGain.connect(this.limiterNode);
      this.limiterNode.connect(safety);
      safety.connect(this.audioContext.destination);

      this.#applyConfig();
    } catch (error) {
      console.error('Failed to start tab capture:', error);
      this.stopCapture();
      throw error;
    }
  }

  stopCapture() {
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.mediaStream = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.limiterNode = null;
    this.levelingCompressor = null;
    this.makeupGain = null;
    this.tabId = null;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.#applyConfig();
  }

  #applyConfig() {
    this.limiterNode?.port.postMessage({ type: 'config', config: this.config });
    applyLeveling(this.levelingCompressor, this.makeupGain, levelingProfileFor(this.config));
  }

  #handleMeter({ db, gain }) {
    if (this.tabId == null) return;
    chrome.runtime.sendMessage({
      type: 'updateDB',
      db: isFinite(db) ? db : -Infinity,
      gainDB: gain > 0 ? 20 * Math.log10(gain) : 0,
      tabId: this.tabId
    }).catch(error => {
      if (!error.message?.includes('Receiving end does not exist')) {
        console.error('Failed to send decibel update:', error);
      }
    });
  }
}

const processor = new OffscreenAudioProcessor();
window.addEventListener('beforeunload', () => { processor.stopCapture(); });
