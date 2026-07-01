class IndexedDBStore {
  private dbName = "universal-assessment-db";
  private storeName = "video-chunks";

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveChunk(index: number, blob: Blob): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.put(blob, `chunk-${index}`);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllChunks(): Promise<Blob[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearStore(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export interface AssessmentRecorderOptions {
  onStop?: (blob: Blob) => void;
  onTimerTick?: (seconds: number) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onAudioLevel?: (level: number) => void;
  cameraPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  cameraShape?: "circle" | "rectangle";
  cameraBorderColor?: string;
  cameraBorderWidth?: number;
  cameraSize?: { width: number; height: number };
  watermarkText?: string;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  watermarkColor?: string;
  watermarkFontSize?: number;
  videoQuality?: "low" | "medium" | "high";
}

export class AssessmentRecorder {
  private screenStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private audioCtx: AudioContext | null = null;
  private timerId: any = null;
  private secondsElapsed = 0;
  private recordedChunks: Blob[] = [];

  constructor(private options: AssessmentRecorderOptions = {}) {}

  updateOptions(options: Partial<AssessmentRecorderOptions>): void {
    this.options = { ...this.options, ...options };
  }

  static async hasRecoverableSession(): Promise<boolean> {
    try {
      const store = new IndexedDBStore();
      const chunks = await store.getAllChunks();
      return chunks.length > 0;
    } catch (e) {
      return false;
    }
  }

  static async recoverSession(): Promise<Blob | null> {
    try {
      const store = new IndexedDBStore();
      const chunks = await store.getAllChunks();
      if (chunks.length === 0) return null;
      return new Blob(chunks, { type: "video/webm" });
    } catch (e) {
      return null;
    }
  }

  static async clearRecoverableSession(): Promise<void> {
    try {
      const store = new IndexedDBStore();
      await store.clearStore();
    } catch (e) {}
  }

  async requestPermissions(): Promise<{ hasCamera: boolean; hasScreen: boolean }> {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: 30 },
        audio: true
      });
    } catch (e) {
      if (this.options.onError) {
        this.options.onError(e instanceof Error ? e : new Error("Camera permission denied"));
      }
      throw e;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
    } catch (e) {
      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach(track => track.stop());
        this.cameraStream = null;
      }
      if (this.options.onError) {
        this.options.onError(e instanceof Error ? e : new Error("Screen share permission denied"));
      }
      throw e;
    }

    return { hasCamera: true, hasScreen: true };
  }

  async start(): Promise<void> {
    if (!this.screenStream || !this.cameraStream) {
      throw new Error("Permissions not granted. Call requestPermissions first.");
    }

    const dbStore = new IndexedDBStore();
    await dbStore.clearStore();

    const screenVideo = document.createElement("video");
    screenVideo.srcObject = this.screenStream;
    screenVideo.muted = true;
    screenVideo.play().catch(() => {});

    const cameraVideo = document.createElement("video");
    cameraVideo.srcObject = this.cameraStream;
    cameraVideo.muted = true;
    cameraVideo.play().catch(() => {});

    const quality = this.options.videoQuality ?? "medium";
    let width = 1280;
    let height = 720;
    if (quality === "low") {
      width = 640;
      height = 360;
    } else if (quality === "high") {
      width = 1920;
      height = 1080;
    }

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");

    const draw = () => {
      if (!this.ctx || !this.canvas) return;

      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (screenVideo.readyState >= 2) {
        this.ctx.drawImage(screenVideo, 0, 0, this.canvas.width, this.canvas.height);
      }

      if (cameraVideo.readyState >= 2) {
        const camWidth = this.options.cameraSize?.width ?? 240;
        const camHeight = this.options.cameraSize?.height ?? 180;
        const position = this.options.cameraPosition ?? "bottom-right";
        const shape = this.options.cameraShape ?? "circle";
        const borderWidth = this.options.cameraBorderWidth ?? 4;
        const borderColor = this.options.cameraBorderColor ?? "#ffffff";

        let x = this.canvas.width - camWidth - 20;
        let y = this.canvas.height - camHeight - 20;

        if (position === "top-left") {
          x = 20;
          y = 20;
        } else if (position === "top-right") {
          x = this.canvas.width - camWidth - 20;
          y = 20;
        } else if (position === "bottom-left") {
          x = 20;
          y = this.canvas.height - camHeight - 20;
        }

        this.ctx.save();
        this.ctx.beginPath();
        if (shape === "circle") {
          const radius = Math.min(camWidth, camHeight) / 2;
          this.ctx.arc(x + camWidth / 2, y + camHeight / 2, radius, 0, Math.PI * 2);
        } else {
          this.ctx.rect(x, y, camWidth, camHeight);
        }
        this.ctx.clip();
        this.ctx.drawImage(cameraVideo, x, y, camWidth, camHeight);
        this.ctx.restore();

        if (borderWidth > 0) {
          this.ctx.strokeStyle = borderColor;
          this.ctx.lineWidth = borderWidth;
          this.ctx.beginPath();
          if (shape === "circle") {
            const radius = Math.min(camWidth, camHeight) / 2;
            this.ctx.arc(x + camWidth / 2, y + camHeight / 2, radius, 0, Math.PI * 2);
          } else {
            this.ctx.rect(x, y, camWidth, camHeight);
          }
          this.ctx.stroke();
        }
      }

      if (this.options.watermarkText) {
        const text = this.options.watermarkText;
        const position = this.options.watermarkPosition ?? "top-left";
        const color = this.options.watermarkColor ?? "rgba(255, 255, 255, 0.4)";
        const fontSize = this.options.watermarkFontSize ?? 20;

        this.ctx.save();
        this.ctx.font = `${fontSize}px sans-serif`;
        this.ctx.fillStyle = color;
        this.ctx.textBaseline = "middle";

        let x = 40;
        let y = 40;

        if (position === "top-left") {
          this.ctx.textAlign = "left";
          x = 40;
          y = 40;
        } else if (position === "top-right") {
          this.ctx.textAlign = "right";
          x = this.canvas.width - 40;
          y = 40;
        } else if (position === "bottom-left") {
          this.ctx.textAlign = "left";
          x = 40;
          y = this.canvas.height - 40;
        } else if (position === "bottom-right") {
          this.ctx.textAlign = "right";
          x = this.canvas.width - 40;
          y = this.canvas.height - 40;
        }

        this.ctx.fillText(text, x, y);
        this.ctx.restore();
      }

      this.animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    const canvasStream = this.canvas.captureStream(30);
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dest = this.audioCtx.createMediaStreamDestination();
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let hasAudio = false;

    if (this.cameraStream.getAudioTracks().length > 0) {
      const camSource = this.audioCtx.createMediaStreamSource(this.cameraStream);
      camSource.connect(analyser);
      camSource.connect(dest);
      hasAudio = true;
    }

    if (this.screenStream.getAudioTracks().length > 0) {
      const screenSource = this.audioCtx.createMediaStreamSource(this.screenStream);
      screenSource.connect(dest);
      hasAudio = true;
    }

    const tracks = [...canvasStream.getVideoTracks()];
    if (hasAudio) {
      tracks.push(...dest.stream.getAudioTracks());
    }

    const mixedStream = new MediaStream(tracks);

    let bitrate = 2_500_000;
    if (quality === "low") {
      bitrate = 800_000;
    } else if (quality === "high") {
      bitrate = 6_000_000;
    }

    const options = { 
      mimeType: "video/webm;codecs=vp9,opus",
      videoBitsPerSecond: bitrate
    };
    try {
      this.mediaRecorder = new MediaRecorder(mixedStream, options);
    } catch (e) {
      this.mediaRecorder = new MediaRecorder(mixedStream);
    }

    this.recordedChunks = [];
    let chunkCount = 0;

    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
        try {
          await dbStore.saveChunk(chunkCount++, e.data);
        } catch (err) {}
      }
    };

    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.recordedChunks, { type: "video/webm" });
      try {
        await dbStore.clearStore();
      } catch (err) {}
      if (this.options.onStop) {
        this.options.onStop(blob);
      }
    };

    this.mediaRecorder.start(1000);

    if (this.options.onStart) {
      this.options.onStart();
    }

    const checkAudioLevel = () => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
      if (this.options.onAudioLevel && analyser) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        this.options.onAudioLevel(average);
      }
      requestAnimationFrame(checkAudioLevel);
    };

    if (hasAudio) {
      checkAudioLevel();
    }

    this.secondsElapsed = 0;
    this.timerId = setInterval(() => {
      this.secondsElapsed++;
      if (this.options.onTimerTick) {
        this.options.onTimerTick(this.secondsElapsed);
      }
    }, 1000);
  }

  pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      if (this.options.onPause) {
        this.options.onPause();
      }
    }
  }

  resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
      this.timerId = setInterval(() => {
        this.secondsElapsed++;
        if (this.options.onTimerTick) {
          this.options.onTimerTick(this.secondsElapsed);
        }
      }, 1000);
      if (this.options.onResume) {
        this.options.onResume();
      }
    }
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }

    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }
}
