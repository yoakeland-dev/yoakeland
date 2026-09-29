import FRAG from "./shaders/wallpaper.frag.glsl?raw";

const VERT = `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`wallpaper shader compile failed: ${log}`);
  }
  return shader;
}

export type WallpaperStyle = "dither" | "scanlines" | "ascii" | "dotmatrix" | "gameboy";

const STYLE_MAP: Record<WallpaperStyle, number> = {
  dither: 0.0,
  scanlines: 1.0,
  ascii: 2.0,
  dotmatrix: 3.0,
  gameboy: 4.0,
};

export function wallpaperGL(
  canvas: HTMLCanvasElement,
  params: string | { src: string; style?: WallpaperStyle; visible?: boolean },
) {
  let src = typeof params === "string" ? params : params.src;
  let style: WallpaperStyle = (typeof params === "string" ? undefined : params.style) ?? "dither";
  // Hidden (a chat with messages keeps the canvas faded out): resizes and theme changes only
  // mark it stale, and it redraws once it's shown again.
  let visible = typeof params === "string" ? true : (params.visible ?? true);
  let stale = false;

  const ctx = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
  if (!ctx) return {};
  const gl = ctx;

  const program = gl.createProgram()!;
  const vertShader = compile(gl, gl.VERTEX_SHADER, VERT);
  const fragShader = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  gl.useProgram(program);

  const uCanvasSize = gl.getUniformLocation(program, "u_canvasSize");
  const uImgSize = gl.getUniformLocation(program, "u_imgSize");
  const uLevels = gl.getUniformLocation(program, "u_levels");
  const uStyle = gl.getUniformLocation(program, "u_style");
  const uAccent = gl.getUniformLocation(program, "u_accent");
  const uPanelBg = gl.getUniformLocation(program, "u_panelBg");

  gl.uniform1f(uLevels, 5.0);
  gl.uniform1f(uStyle, STYLE_MAP[style] ?? 0.0);

  // Theme tokens aren't always hex or rgb() (the quiet room's are oklab()), so resolve them
  // through a 1px 2d canvas, which parses any CSS color and hands back plain rgb.
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true })!;

  function setThemeUniform(loc: WebGLUniformLocation | null, cssVar: string, fallback: number) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = `#${fallback.toString(16).padStart(6, "0")}`;
    probeCtx.fillStyle = value;
    probeCtx.fillRect(0, 0, 1, 1);
    const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
    gl.uniform3f(loc, r / 255, g / 255, b / 255);
  }

  function setThemeUniforms() {
    setThemeUniform(uAccent, "--accent", 0x7c9bff);
    setThemeUniform(uPanelBg, "--panel-bg", 0x16181f);
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  let imgSize = [1, 1];
  let ready = false;

  function draw() {
    if (!ready) return;
    if (!visible) return void (stale = true);
    stale = false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uCanvasSize, w, h);
    gl.uniform2f(uImgSize, imgSize[0], imgSize[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function load(url: string) {
    ready = false;
    const img = new Image();
    img.onload = () => {
      imgSize = [img.naturalWidth, img.naturalHeight];
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
      setThemeUniforms();
      draw();
    };
    img.onerror = () => {
      console.error("wallpaper: failed to load image", url);
    };
    img.src = url;
  }

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(canvas);

  // applySettings() re-themes by setting inline CSS custom properties on
  // <html>, which doesn't otherwise touch the canvas — watch for it so
  // u_accent/u_panelBg don't go stale on a theme switch.
  // Resolving the colours forces style recalcs, so it happens here and at load, not per draw.
  // The quiet room fades its colours over a CSS transition (quietRoom.ts) that never touches
  // the style attribute mid-way, so while it runs the colours are re-read every frame.
  let fading = 0;
  function followFade() {
    setThemeUniforms();
    draw();
    fading = document.documentElement.style.transition ? requestAnimationFrame(followFade) : 0;
  }
  const themeObserver = new MutationObserver(() => {
    if (!fading) followFade();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

  load(src);

  return {
    update(newParams: string | { src: string; style?: WallpaperStyle; visible?: boolean }) {
      const nowVisible = typeof newParams === "string" ? true : (newParams.visible ?? true);
      if (nowVisible !== visible) {
        visible = nowVisible;
        if (visible && stale) draw();
      }
      const newSrc = typeof newParams === "string" ? newParams : newParams.src;
      const newStyle: WallpaperStyle =
        (typeof newParams === "string" ? undefined : newParams.style) ?? "dither";
      if (newSrc !== src) {
        src = newSrc;
        load(newSrc);
      }
      if (newStyle !== style) {
        style = newStyle;
        gl.uniform1f(uStyle, STYLE_MAP[newStyle] ?? 0.0);
        draw();
      }
    },
    destroy() {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(fading);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
    },
  };
}
