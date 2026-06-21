/**
 * ColorGradingShader - Archviz photo-realistic post-processing
 * Vignette + warm highlights + cool shadows + contrast S-curve + saturation
 * + chromatic aberration (screen-space RGB channel split, strongest at screen edges)
 * Compatible with Three.js EffectComposer ShaderPass
 */

const ColorGradingShader = {

    uniforms: {
        tDiffuse:             { value: null },
        vignetteOffset:       { value: 0.78 },   // vignette start radius (lower = bigger vignette)
        vignetteDarkness:     { value: 0.55 },   // blend strength of vignette (was 0.9, too heavy)
        contrast:             { value: 1.12 },   // S-curve strength (was 1.05, barely visible)
        saturation:           { value: 1.06 },   // slight boost keeps materials vivid (was 0.95)
        temperature:          { value: 0.035 },  // warm shift on highlights (was 0.02)
        shadowTint:           { value: 0.018 },  // cool-blue tint in shadows for split-tone look
        // Chromatic aberration: subtle RGB channel split, strongest at screen edges.
        // 0 = off, 0.003 = subtle glass-edge look, 0.008 = heavy lens distortion.
        chromaticAberration:  { value: 0.003 }
    },

    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float vignetteOffset;
        uniform float vignetteDarkness;
        uniform float contrast;
        uniform float saturation;
        uniform float temperature;
        uniform float shadowTint;
        uniform float chromaticAberration;

        varying vec2 vUv;

        void main() {
            // --- Chromatic aberration (radial RGB split) ---
            // The offset vector points away from screen centre, so R shifts out
            // and B shifts in — matching how a real lens disperses colour.
            vec2 dir = vUv - 0.5;                        // vector from centre
            float edgeDist = dot(dir, dir) * 4.0;        // 0 at centre, ~1 at corners
            vec2 aberr = dir * chromaticAberration * edgeDist;

            float r = texture2D(tDiffuse, vUv + aberr      ).r;
            float g = texture2D(tDiffuse, vUv              ).g;
            float b = texture2D(tDiffuse, vUv - aberr      ).b;
            float a = texture2D(tDiffuse, vUv              ).a;
            vec3 color = vec3(r, g, b);

            // --- Vignette (smooth radial darkening) ---
            vec2 center = vUv - 0.5;
            float dist = length(center) * 1.8;
            float vignette = smoothstep(vignetteOffset + 0.4, vignetteOffset - 0.35, dist);
            color *= mix(1.0, vignette, vignetteDarkness);

            // --- Contrast S-curve ---
            color = (color - 0.5) * contrast + 0.5;
            color = clamp(color, 0.0, 1.0);
            color = mix(color, smoothstep(0.0, 1.0, color), 0.22);

            // --- Saturation ---
            float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luminance), color, saturation);

            // --- Split-tone: warm highlights + cool shadows ---
            // Highlights (bright areas): shift toward warm amber
            float hiWeight = smoothstep(0.42, 0.88, luminance);
            color.r += temperature * hiWeight;
            color.g += temperature * 0.35 * hiWeight;
            color.b -= temperature * 0.5 * hiWeight;
            // Shadows (dark areas): faint cool-blue to prevent muddy blacks
            float loWeight = 1.0 - smoothstep(0.0, 0.45, luminance);
            color.b += shadowTint * loWeight;
            color.g += shadowTint * 0.3 * loWeight;

            color = clamp(color, 0.0, 1.0);

            gl_FragColor = vec4(color, a);
        }
    `
};

export { ColorGradingShader };
export default ColorGradingShader;
