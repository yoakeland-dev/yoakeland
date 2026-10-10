<script lang="ts">
  // The camera, scanned for a QR code until one reads. jsQR instead of BarcodeDetector because
  // iOS Safari and desktop Chromium on Linux don't have it.
  import jsQR from "jsqr";
  import { onMount } from "svelte";

  let { onscan, onerror }: { onscan: (text: string) => void; onerror: (message: string) => void } = $props();

  let video: HTMLVideoElement;
  const canvas = document.createElement("canvas");

  onMount(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let dead = false;
    const tick = () => {
      if (dead) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0);
        const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (hit?.data) return onscan(hit.data);
      }
      frame = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.srcObject = s;
        return video.play().then(tick);
      })
      .catch((e) => onerror(e?.name === "NotAllowedError" ? "Camera access was denied." : "Couldn't open the camera."));
    return () => {
      dead = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  });
</script>

<div class="scanner">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted></video>
  <span class="frame"></span>
</div>

<style>
  .scanner {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: #000;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .frame {
    position: absolute;
    inset: 18%;
    border: 2px solid color-mix(in srgb, var(--accent) 85%, #fff);
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
</style>
