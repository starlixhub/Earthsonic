/**
 * frontend/js/audio/exporter.js
 * High-Fidelity Audio WAV Exporter for EARTHSONIC Master Sonification.
 * NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
 *
 * Renders master multi-track mixdown using Web Audio OfflineAudioContext.
 * Encodes broadcast-quality RIFF 16-bit PCM stereo 44.1 kHz WAV file.
 */

/**
 * Convert an AudioBuffer to a standard 16-bit PCM stereo WAV Blob.
 * @param {AudioBuffer} buffer
 * @returns {Blob}
 */
export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  let interleaved;
  if (numChannels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    interleaved = interleaveChannels(left, right);
  } else {
    // Mono to stereo interleave
    const mono = buffer.getChannelData(0);
    interleaved = interleaveChannels(mono, mono);
  }
  
  return encodeWAV(interleaved, format, sampleRate, 2, bitDepth);
}

/**
 * Interleave L and R channel float arrays.
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @returns {Float32Array}
 */
export function interleaveChannels(left, right) {
  const length = left.length + right.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index++] = left[inputIndex];
    result[index++] = right[inputIndex];
    inputIndex++;
  }
  return result;
}

/**
 * Encode interleaved float samples to RIFF WAV format.
 */
function encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  // 1. RIFF Chunk Descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');

  // 2. "fmt " Sub-Chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // 3. "data" Sub-Chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  // 4. PCM Samples writing (16-bit signed integer with clipping prevention)
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1.0, Math.min(1.0, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeAscii(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Export current mixer state to a downloadable WAV file.
 * @param {Object} mixer EarthOrchestraMixer instance
 * @param {string} [filename='EARTHSONIC_NASA_SpaceApps_Mix.wav']
 * @returns {Promise<{blob: Blob, filename: string, sizeBytes: number}>}
 */
export async function exportMixerToWav(mixer, filename = 'EARTHSONIC_NASA_SpaceApps_Mix.wav') {
  if (!mixer) throw new Error('EarthOrchestraMixer instance is required for export');

  await mixer.ensureAudioContext();

  const tracks = mixer.getAllTracks();
  const hasBuffers = tracks.some(t => Boolean(t.buffer));
  if (!hasBuffers) {
    await mixer.loadManifest('/api/sonify/orchestra?duration=20');
  }

  const sampleRate = 44100;
  const duration = Math.max(1.0, mixer.duration || 20.0);

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) {
    throw new Error('OfflineAudioContext is not supported in this browser environment');
  }

  const offlineCtx = new OfflineCtx(2, Math.ceil(sampleRate * duration), sampleRate);
  const masterGain = offlineCtx.createGain();
  const masterLogGain = typeof mixer.masterVolume === 'number' ? mixer.masterVolume * mixer.masterVolume : 0.72;
  masterGain.gain.setValueAtTime(masterLogGain, 0);
  masterGain.connect(offlineCtx.destination);

  const anySolo = tracks.some(t => Boolean(t.isSoloed));

  for (const track of tracks) {
    if (!track.buffer) continue;
    if (track.isMuted) continue;
    if (anySolo && !track.isSoloed) continue;

    const src = offlineCtx.createBufferSource();
    src.buffer = track.buffer;

    const trackGain = offlineCtx.createGain();
    const effGain = typeof track.getLogGain === 'function' ? track.getLogGain() : (track.volume * track.volume);
    trackGain.gain.setValueAtTime(effGain, 0);

    if (typeof offlineCtx.createStereoPanner === 'function') {
      const panner = offlineCtx.createStereoPanner();
      panner.pan.setValueAtTime(track.pan || 0.0, 0);
      src.connect(trackGain);
      trackGain.connect(panner);
      panner.connect(masterGain);
    } else {
      src.connect(trackGain);
      trackGain.connect(masterGain);
    }

    src.start(0);
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWav(renderedBuffer);

  // Trigger browser download if running in DOM
  if (typeof document !== 'undefined' && document.createElement) {
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  return {
    blob: wavBlob,
    filename,
    sizeBytes: wavBlob.size
  };
}
