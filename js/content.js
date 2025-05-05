let audioContext;
let analyser;
let globalGain = 1; // Initial gain (full volume)
let enabled = false; // Default disabled
let limitDB = -20; // Default limit in dBFS
let tabId;
let setupAttempts = 0;
let maxSetupAttempts = 10;
let setupInterval;
let audioInitialized = false;

// Special cases
let isNetflix = window.location.hostname.includes('netflix.com');

function setupAudio() {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioInitialized = true;
    }

    const elements = document.querySelectorAll('audio, video');

    let foundElements = false;

    elements.forEach(element => {
      if (addElement(element)) {
        foundElements = true;
      }
    });

    if (isNetflix || !foundElements) {
      searchInShadowDOM(document.body);
    }

    setupMutationObserver();

    if (isNetflix && !foundElements) {
      if (setupAttempts < maxSetupAttempts) {
        setupAttempts++;
        if (!setupInterval) {
          setupInterval = setInterval(() => {
            const videoElements = document.querySelectorAll('video');
            if (videoElements.length > 0) {
              clearInterval(setupInterval);
              setupInterval = null;
              videoElements.forEach(addElement);
            } else if (setupAttempts >= maxSetupAttempts) {
              clearInterval(setupInterval);
              setupInterval = null;
            } else {
              setupAttempts++;
            }
          }, 1000);
        }
      }
    }

    // If no elements were found, try to initialize AudioContext anyway
    if (!foundElements && !isNetflix) {
      // Create a gain node and connect it to the destination to keep AudioContext active
      const dummyGain = audioContext.createGain();
      dummyGain.connect(audioContext.destination);
    }

    return foundElements;
  } catch (e) {
    console.error(`Error setting up audio: ${e.message}`);
    return false;
  }
}

function searchInShadowDOM(root) {
  if (!root) return;

  // Search in the shadow root if it exists
  if (root.shadowRoot) {
    const shadowElements = root.shadowRoot.querySelectorAll('audio, video');
    shadowElements.forEach(addElement);

    // Search recursively in all shadow root elements
    Array.from(root.shadowRoot.querySelectorAll('*')).forEach(searchInShadowDOM);
  }

  // Search in all child elements
  if (root.children) {
    Array.from(root.children).forEach(searchInShadowDOM);
  }
}

function setupMutationObserver() {
  try {
    // Observe changes in the DOM
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        // Check added nodes
        if (mutation.addedNodes) {
          mutation.addedNodes.forEach(node => {
            // Check if it's an audio/video element
            if (node.nodeType === 1) {
              if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') {
                addElement(node);
              } else {
                // Search for audio/video elements within the added node
                const mediaElements = node.querySelectorAll('audio, video');
                mediaElements.forEach(addElement);

                // Search in Shadow DOM
                searchInShadowDOM(node);
              }
            }
          });
        }
      });
    });

    // Observe the entire document
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      // If document.body does not exist, wait and retry
      setTimeout(() => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }, 500);
    }
  } catch (e) {
    console.error(`Error configuring MutationObserver: ${e.message}`);
  }
}

function addElement(element) {
  if (!element || element._gainNode) return false;

  try {
    // Make sure the element has a valid media source
    if (element.src || element.srcObject || (element.currentSrc && element.currentSrc !== "")) {
      try {
        const source = audioContext.createMediaElementSource(element);
        const gainNode = audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.connect(analyser);
        element._gainNode = gainNode;
        return true;
      } catch (sourceError) {
        // Handle the specific "already connected" error
        if (sourceError.message && sourceError.message.includes('already connected')) {
          console.log(`Media element already connected, setting up gain node directly`);
          // Create a gain node without trying to create a new media element source
          const gainNode = audioContext.createGain();
          gainNode.connect(audioContext.destination);
          element._gainNode = gainNode;
          return true;
        } else {
          // Re-throw other errors
          throw sourceError;
        }
      }
    } else {
      // For elements without a source yet, wait for it to load
      element.addEventListener('loadedmetadata', () => {
        if (!element._gainNode) {
          addElement(element);
        }
      }, { once: true });
    }
  } catch (e) {
    console.error(`Error connecting element: ${e.message}`);
  }
  return false;
}

function getRMS() {
  if (!analyser) return 0;

  // Check if any audio/video elements are actually playing
  const mediaElements = document.querySelectorAll('audio, video');
  let isAnyPlaying = false;

  // Also check shadow DOM elements
  const checkShadowElements = (root) => {
    if (!root) return;

    if (root.shadowRoot) {
      const shadowMedia = root.shadowRoot.querySelectorAll('audio, video');
      shadowMedia.forEach(element => {
        if (!element.paused && !element.ended && element.currentTime > 0) {
          isAnyPlaying = true;
        }
      });

      Array.from(root.shadowRoot.querySelectorAll('*')).forEach(checkShadowElements);
    }

    if (root.children) {
      Array.from(root.children).forEach(checkShadowElements);
    }
  };

  // Check regular DOM elements
  mediaElements.forEach(element => {
    if (!element.paused && !element.ended && element.currentTime > 0) {
      isAnyPlaying = true;
    }
  });

  // Check shadow DOM if needed
  if (!isAnyPlaying && isNetflix) {
    checkShadowElements(document.body);
  }

  // If nothing is playing, return 0 (which will convert to -Infinity dB)
  if (!isAnyPlaying) {
    return 0;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    const sample = (dataArray[i] / 255) * 2 - 1; // Normalize to [-1, 1]
    sum += sample * sample;
  }
  return Math.sqrt(sum / bufferLength); // RMS
}

function update() {
  try {
    // Check if extension context is still valid
    if (chrome.runtime.id === undefined) {
      console.error("Extension context invalidated. Stopping audio processing.");
      return; // Stop execution if context is invalid
    }

    const rms = getRMS();
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity; // Convert to dBFS

    chrome.runtime.sendMessage({
      type: 'updateDB',
      db: db
    }, response => {
      // Handle possible communication errors
      if (chrome.runtime.lastError) {
        // Check if error is due to invalidated context
        if (chrome.runtime.lastError.message.includes("Extension context invalidated")) {
          console.error("Extension context invalidated. Communication stopped.");
          return; // Don't continue if context is invalidated
        }
      }
    });

    if (enabled) {
      const limitRMS = Math.pow(10, limitDB / 20); // Limit in RMS
      if (rms > limitRMS) {
        globalGain = Math.max(0.01, limitRMS / rms); // Reduce gain
      } else {
        globalGain = Math.min(1, globalGain * 1.01); // Increase slowly
      }

      const elements = document.querySelectorAll('audio, video');
      elements.forEach(element => {
        if (element._gainNode) {
          element._gainNode.gain.value = globalGain;
        }
      });

      // Also apply to elements in Shadow DOM for Netflix
      if (isNetflix) {
        applyGainToShadowDOM(document.body);
      }
    } else {
      // Reset gain to 1 (full volume) when limiter is disabled
      if (globalGain !== 1) {
        globalGain = 1;

        // Reset all audio/video elements to full volume
        const elements = document.querySelectorAll('audio, video');
        elements.forEach(element => {
          if (element._gainNode) {
            element._gainNode.gain.value = 1;
          }
        });

        // Also reset elements in Shadow DOM for Netflix
        if (isNetflix) {
          applyGainToShadowDOM(document.body);
        }
      }
    }
  } catch (e) {
    console.error(`Error in update: ${e.message}`);

    // If error is due to invalidated context, stop processing
    if (e.message.includes("Extension context invalidated")) {
      console.warn("Extension context invalidated. Stopping audio processing loop.");
      return; // Don't schedule more updates
    }
  }

  try {
    if (chrome.runtime.id !== undefined) {
      requestAnimationFrame(update);
    }
  } catch (e) {
    console.warn("Could not schedule next update: " + e.message);
  }
}

function applyGainToShadowDOM(root) {
  if (!root) return;

  if (root.shadowRoot) {
    const shadowElements = root.shadowRoot.querySelectorAll('audio, video');
    shadowElements.forEach(element => {
      if (element._gainNode) {
        element._gainNode.gain.value = globalGain;
      }
    });

    Array.from(root.shadowRoot.querySelectorAll('*')).forEach(applyGainToShadowDOM);
  }

  if (root.children) {
    Array.from(root.children).forEach(applyGainToShadowDOM);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setConfig') {
    enabled = message.enabled;
    limitDB = message.limitDB;
    sendResponse({ success: true });
  }

  return true; // Allow async response
});

// Initialize on load
function initialize() {
  // Get configuration from background script
  chrome.runtime.sendMessage({ type: 'getConfig' }, response => {
    if (chrome.runtime.lastError) {
      console.error(`Error getting config: ${chrome.runtime.lastError.message}`);
      setupAudio();
      requestAnimationFrame(update);
      return;
    }

    if (response) {
      tabId = response.tabId;
      enabled = response.enabled;
      limitDB = response.limitDB;
    } else {
      console.warn('No response received from background script, using defaults');
    }

    // Set up audio processing
    const setupSuccess = setupAudio();

    // Start the update loop
    requestAnimationFrame(update);

    // For complex pages like YouTube, try to set up audio again after a delay
    setTimeout(() => {
      if (!audioInitialized || document.querySelectorAll('audio, video').length === 0) {
        setupAudio();
      }
    }, 3000);
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

window.addEventListener('load', () => {
  if (!audioInitialized) {
    setupAudio();
  }
});