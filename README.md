# proctorec-sdk

A lightweight, zero-dependency frontend JavaScript SDK to record combined screen share and webcam streams on the client side. Ideal for online interviews, test-taking platforms, remote coding assessments, and browser-based remote proctoring applications.

## Key Search Terms & Use Cases

This SDK provides client-side solutions for:
- **React screen recorder with webcam overlay**
- **Browser-based screen and camera recorder**
- **Client-side remote proctoring SDK**
- **Simultaneous screen share and audio mixer**
- **Local exam/test recording library**
- **No-server video compositing library**

## Features

- **Circular/Rectangular Webcam Overlay**: Renders the webcam feed on top of the screen share feed in real-time.
- **Dynamic Styling Options**: Position the overlay in any corner, set shapes, sizes, and borders dynamically.
- **Real-Time Video Composition**: Built with off-screen HTML Canvas drawing loops.
- **Dual-Audio Mixing**: Mixes microphone audio and screen share system sounds together seamlessly.
- **Audio Level Analyser**: Real-time microphone audio frequency metrics for visual indicator feedback.
- **IndexedDB Crash Recovery**: Auto-saves video chunks sequentially. If the candidate closes the tab or the browser crashes, the video can be fully recovered and downloaded on reload.
- **Vanilla JS/TypeScript**: Highly universal; can be integrated into any frontend framework (React, Vue, Svelte, Angular, Vanilla JS).

## Installation

Add it to your dependencies from a local path or npm registry:

```bash
npm install proctorec-sdk
```

## Basic Usage

```typescript
import { AssessmentRecorder } from "proctorec-sdk";

const recorder = new AssessmentRecorder({
  cameraPosition: "bottom-right",
  cameraShape: "circle",
  watermarkText: "Universal Assessment Platform",
  onStop: (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "candidate-recording.webm";
    a.click();
  },
  onTimerTick: (secondsElapsed) => {
    console.log(`Time elapsed: ${secondsElapsed}s`);
  },
  onAudioLevel: (averageLevel) => {
    updateAudioMeterUI(averageLevel);
  },
  onError: (error) => {
    console.error("Recording error:", error);
  }
});

await recorder.requestPermissions();
recorder.start();

recorder.updateOptions({
  cameraPosition: "top-left",
  cameraShape: "rectangle"
});

recorder.pause();
recorder.resume();
recorder.stop();
```

## Session Crash Recovery

If the candidate's browser crashes, the SDK stores all recorded chunks inside the browser's IndexedDB. When the page reloads, you can check for recoverable sessions and download the partial recording:

```typescript
import { AssessmentRecorder } from "proctorec-sdk";

const hasRecovery = await AssessmentRecorder.hasRecoverableSession();

if (hasRecovery) {
  const recoveredBlob = await AssessmentRecorder.recoverSession();
  
  if (recoveredBlob) {
    const url = URL.createObjectURL(recoveredBlob);
  }
  
  await AssessmentRecorder.clearRecoverableSession();
}
```

## Options Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cameraPosition` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Corner position of the webcam preview overlay. |
| `cameraShape` | `'circle' \| 'rectangle'` | `'circle'` | Overlay bounding shape. |
| `cameraBorderColor` | `string` | `'#ffffff'` | Color of the webcam overlay border. |
| `cameraBorderWidth` | `number` | `4` | Width of the border in pixels (set `0` to disable). |
| `cameraSize` | `{ width: number, height: number }` | `{ width: 240, height: 180 }` | Target size of the webcam overlay. |
| `watermarkText` | `string` | `undefined` | Overlay text drawn onto the final video. |
| `watermarkPosition` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'top-left'` | Watermark position. |
| `watermarkColor` | `string` | `'rgba(255, 255, 255, 0.4)'` | Watermark text fill style. |
| `watermarkFontSize` | `number` | `20` | Font size in pixels. |
| `videoQuality` | `'low' \| 'medium' \| 'high'` | `'medium'` | Recording resolution & bitrate settings (`low` = 360p/800Kbps, `medium` = 720p/2.5Mbps, `high` = 1080p/6Mbps). |
