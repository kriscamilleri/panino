import { getCurrentInstance, onUnmounted, ref } from 'vue';

const SVG_WIDTH = 40;
const SVG_HEIGHT = 16;
const NUM_POINTS = 8;
const MIDLINE_Y = SVG_HEIGHT / 2;
const WAVEFORM_GAIN = 3;
const WAVEFORM_MIN_Y = 1;
const WAVEFORM_MAX_Y = SVG_HEIGHT - 1;

function buildFlatWaveformPoints() {
  return Array.from({ length: NUM_POINTS }, (_, index) => {
    const x = (index / (NUM_POINTS - 1)) * SVG_WIDTH;
    return `${x.toFixed(1)},${MIDLINE_Y.toFixed(1)}`;
  }).join(' ');
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getAudioContextConstructor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function getErrorCode(error) {
  return error?.error || error?.name || '';
}

function isPermissionDenied(error) {
  const code = getErrorCode(error);
  return code === 'not-allowed' || code === 'permission-denied' || code === 'NotAllowedError';
}

function isAvailabilityError(error) {
  const code = getErrorCode(error);
  return code === 'service-not-allowed' || code === 'network' || code === 'audio-unavailable' || code === 'audio-capture';
}

export function useDictation({ onFinalResult, onInterimResult, onError } = {}) {
  const isSupported = Boolean(getSpeechRecognitionConstructor());
  const isRecording = ref(false);
  const elapsedSeconds = ref(0);
  const interimTranscript = ref('');
  const waveformPoints = ref(buildFlatWaveformPoints());

  let recognition = null;
  let audioContext = null;
  let analyser = null;
  let audioSource = null;
  let mediaStream = null;
  let timerHandle = null;
  let rafHandle = null;
  let restartHandle = null;
  let stopRequested = false;
  let sessionErrorShown = false;
  let disableWaveform = false;
  let retryWithoutWaveformPending = false;

  function resetWaveform() {
    waveformPoints.value = buildFlatWaveformPoints();
  }

  function clearTimer() {
    if (timerHandle !== null) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function startTimer() {
    clearTimer();
    timerHandle = setInterval(() => {
      elapsedSeconds.value += 1;
    }, 1000);
  }

  function clearRestart() {
    if (restartHandle !== null) {
      clearTimeout(restartHandle);
      restartHandle = null;
    }
  }

  function stopWaveformLoop() {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    resetWaveform();
  }

  async function cleanupAudio() {
    stopWaveformLoop();

    if (audioSource?.disconnect) {
      try {
        audioSource.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }
    }

    if (analyser?.disconnect) {
      try {
        analyser.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }
    }

    if (mediaStream?.getTracks) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
    }

    audioSource = null;
    analyser = null;
    mediaStream = null;

    if (audioContext?.close) {
      try {
        await audioContext.close();
      } catch {
        // Ignore close errors during teardown.
      }
    }

    audioContext = null;
  }

  function showSessionError(error) {
    if (sessionErrorShown) return;
    sessionErrorShown = true;

    if (isPermissionDenied(error)) {
      if (typeof onError === 'function') {
        onError('permission-denied', error);
      }
      return;
    }

    if (isAvailabilityError(error) && typeof onError === 'function') {
      onError('unavailable', error);
    }
  }

  function ensureRecognition() {
    if (recognition || !isSupported) return recognition;

    const SpeechRecognition = getSpeechRecognitionConstructor();
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';

    recognition.onstart = () => {
      if (disableWaveform || mediaStream || audioContext) return;

      startWaveformLoop().catch(async (error) => {
        disableWaveform = true;
        console.warn('[Dictation] Waveform initialization failed; continuing without visualizer.', error);
        await cleanupAudio();
      });
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimText = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? '';

        if (result?.isFinal) {
          finalTranscript += transcript;
        } else {
          interimText += transcript;
        }
      }

      interimTranscript.value = interimText;

      if (typeof onInterimResult === 'function') {
        onInterimResult(interimText);
      }

      if (finalTranscript.trim() && typeof onFinalResult === 'function') {
        onFinalResult(finalTranscript);
      }
    };

    recognition.onerror = async (event) => {
      if (event?.error === 'no-speech') return;

      console.warn('[Dictation] Speech recognition error:', event?.error, event?.message || '');

      const shouldRetryWithoutWaveform =
        event?.error === 'network' &&
        !disableWaveform &&
        !retryWithoutWaveformPending &&
        !stopRequested &&
        Boolean(mediaStream || audioContext);

      if (shouldRetryWithoutWaveform) {
        disableWaveform = true;
        retryWithoutWaveformPending = true;
        await cleanupAudio();
        return;
      }

      stopRequested = true;
      showSessionError(event);
      isRecording.value = false;
      elapsedSeconds.value = 0;
      interimTranscript.value = '';
      clearTimer();
      clearRestart();
      await cleanupAudio();

      try {
        recognition?.stop();
      } catch {
        // Recognition may already be stopping.
      }
    };

    recognition.onend = () => {
      if (!stopRequested && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        clearRestart();
        restartHandle = setTimeout(() => {
          try {
            retryWithoutWaveformPending = false;
            recognition?.start();
          } catch (error) {
            stopRequested = true;
            showSessionError({ error: 'network', cause: error });
            isRecording.value = false;
            elapsedSeconds.value = 0;
            interimTranscript.value = '';
            clearTimer();
            cleanupAudio();
          }
        }, 150);
        return;
      }

      clearRestart();
    };

    return recognition;
  }

  async function startWaveformLoop() {
    const AudioContext = getAudioContextConstructor();
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;

    if (!AudioContext || !mediaDevices?.getUserMedia) {
      throw { error: 'audio-unavailable' };
    }

    mediaStream = await mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();

    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      try {
        await audioContext.resume();
      } catch {
        // Continue even if resume is unnecessary or unsupported.
      }
    }

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioSource = audioContext.createMediaStreamSource(mediaStream);
    audioSource.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!isRecording.value || !analyser) return;

      analyser.getByteTimeDomainData(data);
      waveformPoints.value = Array.from({ length: NUM_POINTS }, (_, index) => {
        const dataIndex = Math.floor((index * data.length) / NUM_POINTS);
        const amplitude = (data[dataIndex] - 128) / 128;
        const x = (index / (NUM_POINTS - 1)) * SVG_WIDTH;
        const y = Math.min(
          WAVEFORM_MAX_Y,
          Math.max(WAVEFORM_MIN_Y, MIDLINE_Y + amplitude * (MIDLINE_Y - 1) * WAVEFORM_GAIN),
        );
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');

      rafHandle = requestAnimationFrame(tick);
    };

    rafHandle = requestAnimationFrame(tick);
  }

  async function startDictation() {
    if (!isSupported || isRecording.value) return;

    stopRequested = false;
    sessionErrorShown = false;
    retryWithoutWaveformPending = false;
    elapsedSeconds.value = 0;
    interimTranscript.value = '';
    resetWaveform();

    const activeRecognition = ensureRecognition();
    activeRecognition.lang = typeof navigator !== 'undefined' ? navigator.language : activeRecognition.lang;

    isRecording.value = true;
    startTimer();

    try {
      activeRecognition.start();
    } catch (error) {
      stopRequested = true;
      showSessionError(error);
      isRecording.value = false;
      elapsedSeconds.value = 0;
      interimTranscript.value = '';
      clearTimer();
      clearRestart();
      await cleanupAudio();

      try {
        activeRecognition.stop();
      } catch {
        // Recognition may not have started.
      }

      return;
    }

  }

  async function stopDictation() {
    stopRequested = true;
    retryWithoutWaveformPending = false;
    isRecording.value = false;
    elapsedSeconds.value = 0;
    interimTranscript.value = '';
    clearTimer();
    clearRestart();
    await cleanupAudio();

    try {
      recognition?.stop();
    } catch {
      // Recognition may already be stopped.
    }
  }

  const handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden' && isRecording.value) {
      stopDictation();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  if (getCurrentInstance()) {
    onUnmounted(() => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      stopDictation();
    });
  }

  return {
    isSupported,
    isRecording,
    elapsedSeconds,
    interimTranscript,
    waveformPoints,
    startDictation,
    stopDictation,
  };
}