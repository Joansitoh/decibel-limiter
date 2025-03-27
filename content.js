let audioContext;
let analyser;
let globalGain = 1; // Initial gain (full volume)
let enabled = false; // Default disabled
let limitDB = -10; // Default limit in dBFS
let tabId;
let setupAttempts = 0;
let maxSetupAttempts = 10;
let setupInterval;

// special cases
let isNetflix = window.location.hostname.includes('netflix.com');

function setupAudio() {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
    }

    const elements = document.querySelectorAll('audio, video');
    let foundElements = false;
    
    elements.forEach(element => {
      if (addElement(element)) {
        foundElements = true;
      }
    });

    // Search in Shadow DOM for sites like Netflix
    if (isNetflix || !foundElements) {
      searchInShadowDOM(document.body);
    }

    // Observe changes in the DOM
    setupMutationObserver();
    
    // If we are in Netflix and no elements are found, schedule retries
    if (isNetflix && !foundElements) {
      if (setupAttempts < maxSetupAttempts) {
        console.log(`Attempt ${setupAttempts + 1} to configure audio in Netflix. Retrying in 1 second...`);
        setupAttempts++;
        if (!setupInterval) {
          setupInterval = setInterval(() => {
            const videoElements = document.querySelectorAll('video');
            if (videoElements.length > 0) {
              clearInterval(setupInterval);
              setupInterval = null;
              console.log(`Video elements found in Netflix after ${setupAttempts} attempts`);
              videoElements.forEach(addElement);
            } else if (setupAttempts >= maxSetupAttempts) {
              clearInterval(setupInterval);
              setupInterval = null;
              console.log('Maximum number of attempts reached to find video in Netflix');
            } else {
              setupAttempts++;
            }
          }, 1000);
        }
      }
    }
  } catch (e) {
    console.log(`Error setting up audio: ${e.message}`);
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
    console.log(`Error configuring MutationObserver: ${e.message}`);
  }
}

function addElement(element) {
  if (!element || element._gainNode) return false;
  
  try {
    // Asegurarse de que el elemento tenga una fuente de medios válida
    if (element.src || element.srcObject || (element.currentSrc && element.currentSrc !== "")) {
      const source = audioContext.createMediaElementSource(element);
      const gainNode = audioContext.createGain();
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      source.connect(analyser);
      element._gainNode = gainNode;
      console.log(`Media element connected: ${element.tagName}`);
      return true;
    } else {
      // For elements without a source yet, wait for it to load
      element.addEventListener('loadedmetadata', () => {
        if (!element._gainNode) {
          addElement(element);
        }
      }, { once: true });
    }
  } catch (e) {
    console.log(`Error connecting element: ${e.message}`);
  }
  return false;
}

function getRMS() {
  if (!analyser) return 0;
  
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
    const rms = getRMS();
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity; // Convert to dBFS
    chrome.runtime.sendMessage({ type: 'updateDB', db }, response => {
      if (chrome.runtime.lastError) {
        // Ignore common communication errors
        if (!chrome.runtime.lastError.message.includes('receiving end does not exist')) {
          console.log(`Error sending dB: ${chrome.runtime.lastError.message}`);
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
    }
  } catch (e) {
    console.log(`Error en update: ${e.message}`);
  }
}

function applyGainToShadowDOM(root) {
  if (!root) return;
  
  // Apply to elements in the shadow root
  if (root.shadowRoot) {
    const shadowElements = root.shadowRoot.querySelectorAll('audio, video');
    shadowElements.forEach(element => {
      if (element._gainNode) {
        element._gainNode.gain.value = globalGain;
      }
    });
    
    // Search recursively in all shadow root elements
    Array.from(root.shadowRoot.querySelectorAll('*')).forEach(applyGainToShadowDOM);
  }
  
  // Search in all child elements
  if (root.children) {
    Array.from(root.children).forEach(applyGainToShadowDOM);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setConfig') {
    enabled = message.enabled;
    limitDB = message.limitDB;
  }
});

// Initialize on load
function initialize() {
  chrome.runtime.sendMessage({ type: 'getConfig' }, response => {
    if (chrome.runtime.lastError) {
      console.log(`Error getting config: ${chrome.runtime.lastError.message}`);
      // Retry after a short delay
      setTimeout(initialize, 500);
      return;
    }
    tabId = response.tabId;
    enabled = response.enabled;
    limitDB = response.limitDB;
    
    // Configure audio
    setupAudio();
    
    // Start periodic updates
    setInterval(update, 100); // Update every 100ms
    
    // For Netflix, try configuring the audio again after the page is fully loaded
    if (isNetflix) {
      window.addEventListener('load', () => {
        setTimeout(setupAudio, 2000); // Wait 2 seconds after complete load
      });
      
      // Also try when the user interacts with the page
      document.addEventListener('click', () => {
        setTimeout(setupAudio, 500);
      }, { once: false });
    }
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}