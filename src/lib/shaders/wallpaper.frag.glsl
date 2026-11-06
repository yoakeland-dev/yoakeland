#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform vec2 u_canvasSize;
uniform vec2 u_imgSize;
uniform float u_levels;
uniform float u_style; // 0=dither, 1=scanlines, 2=mosaic, 4=gameboy, 5=none
uniform vec3 u_accent;
uniform vec3 u_panelBg;
uniform float u_fade; // 1: fades into the panel toward the bottom, behind the composer. 0: keeps its edges.

out vec4 outColor;

const float bayer8x8[64] = float[64](
  0.0,32.0, 8.0,40.0, 2.0,34.0,10.0,42.0,
  48.0,16.0,56.0,24.0,50.0,18.0,58.0,26.0,
  12.0,44.0, 4.0,36.0,14.0,46.0, 6.0,38.0,
  60.0,28.0,52.0,20.0,62.0,30.0,54.0,22.0,
   3.0,35.0,11.0,43.0, 1.0,33.0, 9.0,41.0,
  51.0,19.0,59.0,27.0,49.0,17.0,57.0,25.0,
  15.0,47.0, 7.0,39.0,13.0,45.0, 5.0,37.0,
  63.0,31.0,55.0,23.0,61.0,29.0,53.0,21.0
);

vec3 gbColor(int idx) {
  float shade = mix(0.18, 1.0, float(idx) / 3.0);
  return u_accent * shade;
}

float getLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_canvasSize;
  uv.y = 1.0 - uv.y;

  float canvasAspect = u_canvasSize.x / u_canvasSize.y;
  float imgAspect = u_imgSize.x / u_imgSize.y;
  vec2 scale = canvasAspect > imgAspect
    ? vec2(1.0, imgAspect / canvasAspect)
    : vec2(canvasAspect / imgAspect, 1.0);

  vec2 st = (uv - 0.5) * scale + 0.5;
  vec3 color = vec3(0.0);
  int mode = int(u_style + 0.5);

  if (mode == 0) {
    float ditherScale = 2.0;
    vec2 gridResolution = u_canvasSize / ditherScale;
    vec2 pixelatedSt = floor(st * gridResolution) / gridResolution;
    color = texture(u_tex, pixelatedSt).rgb;

    vec2 pixelPos = floor(gl_FragCoord.xy / ditherScale);
    int bx = int(mod(pixelPos.x, 8.0));
    int by = int(mod(pixelPos.y, 8.0));
    float bayerBase = (bayer8x8[by * 8 + bx] + 0.5) / 64.0 - 0.5;

    int bxShift = int(mod(pixelPos.x + 4.0, 8.0));
    int byShift = int(mod(pixelPos.y + 4.0, 8.0));
    float bayerShifted = (bayer8x8[byShift * 8 + bxShift] + 0.5) / 64.0 - 0.5;

    float grain = hash21(pixelPos);
    float luma = getLuma(color);
    float rangeMask = smoothstep(0.02, 0.18, luma) * smoothstep(0.98, 0.82, luma);

    float noiseBlend = (grain - 0.5) * 0.35 * rangeMask;
    float finalThreshold = mix(bayerBase, bayerShifted, clamp(grain + noiseBlend, 0.0, 1.0)) + noiseBlend * 0.1;
    color = floor(color * (u_levels - 1.0) + finalThreshold + 0.5) / (u_levels - 1.0);
    color = mix(u_panelBg, color, luma);

  } else if (mode == 1) {
    float ditherScale = 2.0;
    vec2 gridResolution = u_canvasSize / ditherScale;
    vec2 pixelatedSt = floor(st * gridResolution) / gridResolution;
    color = texture(u_tex, pixelatedSt).rgb;

    vec2 pixelPos = floor(gl_FragCoord.xy / ditherScale);
    float scanline = mod(pixelPos.y, 2.0) < 1.0 ? 1.0 : 0.72;
    float grain = (hash21(pixelPos) - 0.5) * 0.06;
    color = clamp(color * scanline + grain, 0.0, 1.0);

  } else if (mode == 2) {
    // Soft mosaic: big rounded tiles, each the average of its cell, flat and low in detail.
    float tile = 24.0;
    vec2 cellCoord = floor(gl_FragCoord.xy / tile);
    vec2 centerPx = (cellCoord + 0.5) * tile;
    vec3 avg = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 off = (vec2(float(i & 1), float(i >> 1)) - 0.5) * tile * 0.6;
      vec2 cuv = (centerPx + off) / u_canvasSize;
      cuv.y = 1.0 - cuv.y;
      avg += texture(u_tex, (cuv - 0.5) * scale + 0.5).rgb * 0.25;
    }
    avg *= 0.9 + 0.1 * hash21(cellCoord); // faint per-tile variation
    vec2 local = gl_FragCoord.xy - centerPx;
    float d = sdRoundBox(local, vec2(tile * 0.5 - 1.5), tile * 0.22);
    float m = smoothstep(0.75, -0.75, d);
    color = mix(u_panelBg, mix(u_panelBg, avg, 0.7), m);

  } else if (mode == 4) {
    float gbPixelSize = 8.0;

    vec2 pixelCoord = floor(gl_FragCoord.xy / gbPixelSize);
    vec2 pixelCenter = (pixelCoord + 0.5) * gbPixelSize;
    vec2 sampleUV = pixelCenter / u_canvasSize;
    sampleUV.y = 1.0 - sampleUV.y;
    vec2 sampleSt = (sampleUV - 0.5) * scale + 0.5;

    vec3 srcCol = texture(u_tex, sampleSt).rgb;

    int bx = int(mod(pixelCoord.x, 8.0));
    int by = int(mod(pixelCoord.y, 8.0));
    float bayer = (bayer8x8[by * 8 + bx] + 0.5) / 64.0 - 0.5;

    float luma = getLuma(srcCol);
    luma = clamp(luma + bayer * 0.15, 0.0, 1.0);

    int paletteIdx = int(clamp(floor(luma * 4.0), 0.0, 3.0));
    vec3 baseGbColor = gbColor(paletteIdx);

    vec2 pixelLocal = mod(gl_FragCoord.xy, gbPixelSize) / gbPixelSize; // [0.0, 1.0]
    vec2 pNorm = (pixelLocal - 0.5) * 2.0;                             // [-1.0, 1.0]

    float innerVignette = smoothstep(1.3, 0.2, length(pNorm));
    vec2 borderD = abs(pNorm);
    float edgeGap = smoothstep(1.0, 0.72, max(borderD.x, borderD.y));

    color = baseGbColor * (innerVignette * 0.35 + 0.65) * edgeGap;

  } else {
    color = texture(u_tex, st).rgb;
  }

  float fade = smoothstep(0.0, 1.0, 1.0 - uv.y);
  color = mix(u_panelBg, color, mix(1.0, fade, u_fade));
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
