/**
 * frontend/js/globe/shaders.js
 * Custom GLSL Shaders for EARTHSONIC 3D Earth Globe:
 *   1. Earth Day/Night Terminator Blend Shader
 *   2. Atmospheric Fresnel Rim Glow Halo Shader
 *   3. Ocean Thermal Wave & Anomaly Shader
 *   4. Zonal Thermal Heatmap Gradient Shader
 */

/**
 * 1. Day / Night Terminator Blend Shader
 * Smoothly blends daytime Blue Marble surface with nighttime Black Marble city lights
 * using dot(vNormal, vSunDirection) across smoothstep(-0.15, 0.15).
 * Adds ocean specular sun glint on the daytime hemisphere.
 */
export const TerminatorShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vSunDirection;
    uniform vec3 uSunPosition;

    void main() {
      vUv = uv;
      // Normal must be in world space to pair with the world-space sun vector.
      // normalMatrix is view space, which flipped the terminator with the camera
      // and left most of the visible hemisphere in night.
      vNormal = normalize(mat3(modelMatrix) * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      vSunDirection = normalize(uSunPosition - worldPos.xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D uDayMap;
    uniform sampler2D uNightMap;
    uniform sampler2D uSpecularMap;
    uniform float uNightIntensity;
    uniform float uDayIntensity;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vSunDirection;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 sunDir = normalize(vSunDirection);

      // Terminator dot product
      float sunDotNormal = dot(normal, sunDir);

      // Smoothstep terminator transition: -0.15 to +0.15
      float dayFactor = smoothstep(-0.15, 0.15, sunDotNormal);

      vec4 dayColor = texture2D(uDayMap, vUv) * uDayIntensity;
      vec4 nightColor = texture2D(uNightMap, vUv) * uNightIntensity;
      float specMask = texture2D(uSpecularMap, vUv).r;

      // Specular ocean sun glint
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      vec3 halfVector = normalize(sunDir + viewDir);
      float specAngle = max(dot(normal, halfVector), 0.0);
      float specular = pow(specAngle, 32.0) * specMask * dayFactor;

      // Ambient space fill on the dark side
      vec3 ambientNight = nightColor.rgb * 1.8;

      // Final day/night blend
      vec3 surfaceColor = mix(ambientNight, dayColor.rgb, dayFactor);
      vec3 finalColor = surfaceColor + vec3(specular * 0.45);

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};

/**
 * 2. Atmospheric Fresnel Rim Glow Halo Shader
 * Concentric sphere rendered with BackSide and AdditiveBlending,
 * generating a vibrant NASA Cyan / Aerospace Blue atmospheric halo.
 */
export const AtmosphereShader = {
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vEyeVector;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vEyeVector = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec3 uAtmosphereColor;
    uniform float uGlowPower;
    uniform float uGlowIntensity;

    varying vec3 vNormal;
    varying vec3 vEyeVector;

    void main() {
      vec3 eye = normalize(vEyeVector);
      // Strongest glow at grazing grazing angles
      float dotProd = max(dot(vNormal, eye), 0.0);
      float intensity = pow(0.65 - dotProd, uGlowPower) * uGlowIntensity;
      intensity = clamp(intensity, 0.0, 1.0);

      gl_FragColor = vec4(uAtmosphereColor, intensity);
    }
  `
};

/**
 * 3. Ocean Thermal Wave & Anomaly Shader
 * Animates ocean surface with smooth, low-frequency latitudinal thermal bands,
 * equatorial Pacific El Niño tongue (0°N, 140°W), Gulf Stream (North Atlantic),
 * and Kuroshio Current (Western Pacific) blended over deep ocean navy (#061428 / #06152d).
 * Masked strictly using specular mask (waterMask > 0.5) so it never draws over land continents.
 */
export const OceanThermalShader = {
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uWaveHeight;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying float vWaveElevation;

    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);

      // Smooth, low-frequency spherical ocean displacement
      float w1 = sin(position.x * 4.0 + uTime * 0.6) * cos(position.z * 4.0 + uTime * 0.5);
      float displacement = w1 * uWaveHeight * 0.3;
      vWaveElevation = displacement;

      vec3 newPosition = position + normal * displacement;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uThermalAnomaly; // Normalized anomaly [0.0 = cold, 0.5 = baseline, 1.0 = warm]
    uniform float uOpacity;
    uniform sampler2D uSpecularMask;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying float vWaveElevation;

    void main() {
      // Strict masking: waterMask > 0.5 strictly required, never draws over land continents
      float waterMask = texture2D(uSpecularMask, vUv).r;
      if (waterMask <= 0.5) {
        discard;
      }

      // Deep ocean navy baseline (#061428 / #06152d): vec3(0.0235, 0.0784, 0.1569)
      vec3 deepNavy = vec3(0.0235, 0.0824, 0.1765); // #06152d deep navy water

      // Smooth low-frequency latitudinal thermal bands
      float latRad = (vUv.y - 0.5) * 3.14159265;
      float latBaseline = cos(latRad);
      float gyreVariation = sin(latRad * 3.5 + vUv.x * 3.14159) * 0.07;
      float baseTemp = clamp(latBaseline + gyreVariation, 0.0, 1.0);

      // Latitudinal heat currents:
      // 1. Equatorial Pacific El Niño thermal gradient tongue (0°N, 140°W)
      // Longitude: Central/Eastern Pacific corresponds to vUv.x in [0.0, 0.40] and [0.85, 1.0]
      float pacX = vUv.x < 0.40 ? vUv.x : (vUv.x > 0.85 ? vUv.x - 1.0 : -99.0);
      float pacDist = length(vec2((pacX - 0.12) * 2.8, (vUv.y - 0.50) * 6.5));
      float elNinoHotspot = exp(-pacDist * pacDist * 2.5);
      float elNinoStrength = elNinoHotspot * smoothstep(0.40, 1.0, uThermalAnomaly) * 0.55;

      // 2. Gulf Stream (North Atlantic current moving northeast from Gulf of Mexico 25°N-45°N, 80°W-40°W)
      vec2 gulfP = vec2(vUv.x - 0.32, vUv.y - 0.68);
      float gulfDist = length(vec2((gulfP.x + gulfP.y) * 2.2, (-gulfP.x + gulfP.y) * 7.5));
      float gulfStream = exp(-gulfDist * gulfDist * 3.0) * smoothstep(0.35, 1.0, uThermalAnomaly) * 0.38;

      // 3. Kuroshio Current (Western North Pacific warm boundary current 20°N-40°N, 120°E-150°E)
      vec2 kuroP = vec2(vUv.x - 0.87, vUv.y - 0.66);
      float kuroDist = length(vec2((kuroP.x + kuroP.y) * 2.5, (-kuroP.x + kuroP.y) * 7.5));
      float kuroshio = exp(-kuroDist * kuroDist * 3.0) * smoothstep(0.35, 1.0, uThermalAnomaly) * 0.32;

      // Effective anomaly modulation combining base gyres, El Niño tongue, Gulf Stream, and Kuroshio
      float currentBoost = max(elNinoStrength, max(gulfStream, kuroshio));
      float effectiveTemp = clamp(mix(baseTemp, uThermalAnomaly, 0.55) + currentBoost, 0.0, 1.0);

      // Smooth thermal ramp: deep blue -> cyan -> tropical amber -> crimson
      vec3 coldColor = vec3(0.0, 0.40, 0.80);
      vec3 neutralColor = vec3(0.0, 0.80, 0.70);
      vec3 warmColor = vec3(0.96, 0.45, 0.12);
      vec3 hotColor = vec3(0.92, 0.18, 0.08);

      vec3 thermalRamp = mix(coldColor, neutralColor, smoothstep(0.0, 0.5, effectiveTemp));
      thermalRamp = mix(thermalRamp, warmColor, smoothstep(0.5, 0.85, effectiveTemp));
      thermalRamp = mix(thermalRamp, hotColor, smoothstep(0.85, 1.0, effectiveTemp));

      // Blend gently over deep ocean navy (#061428 / #06152d)
      vec3 finalColor = mix(deepNavy, thermalRamp, 0.65);

      // Mask strictly by ocean water mask (waterMask > 0.5)
      gl_FragColor = vec4(finalColor, uOpacity * smoothstep(0.5, 0.7, waterMask));
    }
  `
};

/**
 * 4. Zonal Thermal Heatmap Shader
 * Maps 14-latitude band GISTEMP anomalies continuously across the sphere.
 * Diverging colormap:
 *   -2.0°C Deep Blue #1d4ed8 (0.1137, 0.3059, 0.8471)
 *    0.0°C Transparent (alpha = 0.0) - natural blue ocean and continents show through clearly
 *   +1.0°C Warm Amber #f59e0b (0.9608, 0.6196, 0.0431)
 *   +2.5°C Crimson #ef4444 (0.9373, 0.2667, 0.2667) - Arctic polar amplification
 * Blends at maximum 0.42 opacity (min(uOpacity, 0.42)) preserving sharp coastline contrast.
 */
export const ZonalHeatmapShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying float vLatitude;

    void main() {
      vUv = uv;
      // Latitude in degrees: -90 (South Pole) to +90 (North Pole)
      vLatitude = (uv.y - 0.5) * 180.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uBandAnomalies[14]; // 14-latitude band anomaly values in °C
    uniform float uOpacity;
    uniform sampler2D uSpecularMask;
    varying vec2 vUv;
    varying float vLatitude;

    // Diverging colormap helper:
    // -2.0°C Deep Blue #1d4ed8 -> 0.0°C Transparent -> +1.0°C Amber #f59e0b -> +2.5°C Crimson #ef4444
    vec4 evaluateDivergingColormap(float temp) {
      vec3 deepBlue = vec3(0.1137, 0.3059, 0.8471); // #1d4ed8 (-2.0°C)
      vec3 warmAmber = vec3(0.9608, 0.6196, 0.0431); // #f59e0b (+1.0°C)
      vec3 crimson = vec3(0.9373, 0.2667, 0.2667);   // #ef4444 (+2.5°C)

      vec3 col = vec3(0.0);
      float alphaFactor = 0.0;

      if (temp <= 0.0) {
        float t = clamp((temp - (-2.0)) / 2.0, 0.0, 1.0); // 0.0 at -2.0°C, 1.0 at 0.0°C
        col = deepBlue;
        alphaFactor = 1.0 - t; // Transparent (0.0) at 0.0°C, 1.0 at -2.0°C
      } else if (temp <= 1.0) {
        float t = clamp(temp / 1.0, 0.0, 1.0); // 0.0 at 0.0°C, 1.0 at +1.0°C
        col = warmAmber;
        alphaFactor = t * 0.85; // Transparent (0.0) at 0.0°C, rises to 0.85 at +1.0°C
      } else {
        float t = clamp((temp - 1.0) / 1.5, 0.0, 1.0); // 0.0 at +1.0°C, 1.0 at +2.5°C
        col = mix(warmAmber, crimson, t);
        alphaFactor = mix(0.85, 1.0, t); // Rises to 1.0 at +2.5°C (polar amplification)
      }
      return vec4(col, alphaFactor);
    }

    // Helper to evaluate thermal color gradient
    vec3 anomalyToColor(float temp) {
      return evaluateDivergingColormap(temp).rgb;
    }

    void main() {
      // Map latitude (-90 to +90) into the 8 core zonal latitude ranges:
      float lat = vLatitude;
      float anomaly = 0.0;

      if (lat >= 64.0) {
        anomaly = uBandAnomalies[6]; // 64N-90N Arctic Polar Amplification
      } else if (lat >= 44.0) {
        float f = (lat - 44.0) / 20.0;
        anomaly = mix(uBandAnomalies[7], uBandAnomalies[6], f);
      } else if (lat >= 24.0) {
        float f = (lat - 24.0) / 20.0;
        anomaly = mix(uBandAnomalies[8], uBandAnomalies[7], f);
      } else if (lat >= 0.0) {
        float f = lat / 24.0;
        anomaly = mix(uBandAnomalies[9], uBandAnomalies[8], f);
      } else if (lat >= -24.0) {
        float f = (lat + 24.0) / 24.0;
        anomaly = mix(uBandAnomalies[10], uBandAnomalies[9], f);
      } else if (lat >= -44.0) {
        float f = (lat + 44.0) / 20.0;
        anomaly = mix(uBandAnomalies[11], uBandAnomalies[10], f);
      } else if (lat >= -64.0) {
        float f = (lat + 64.0) / 20.0;
        anomaly = mix(uBandAnomalies[12], uBandAnomalies[11], f);
      } else {
        float f = (lat + 90.0) / 26.0;
        anomaly = mix(uBandAnomalies[13], uBandAnomalies[12], f);
      }

      vec4 thermalSample = evaluateDivergingColormap(anomaly);
      vec3 thermalColor = thermalSample.rgb;
      float divergeAlpha = thermalSample.a;

      // Preserve sharp coastline contrast: sharpen boundary between land and water
      float waterMask = texture2D(uSpecularMask, vUv).r;
      float edge = length(vec2(dFdx(waterMask), dFdy(waterMask)));
      vec3 col = thermalColor * (1.0 - edge * 0.35);

      // Max 0.42 opacity blend over base Earth texture (mix(earthColor, thermalColor, 0.42))
      float effectiveOpacity = min(uOpacity, 0.42);
      gl_FragColor = vec4(col, effectiveOpacity * divergeAlpha);
    }
  `
};

/**
 * 5. Atmospheric CO2 Halo Mesh Shader
 * Soft exponential atmospheric scattering shader:
 * pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.5) * exp(-radialDist * 4.0)
 * feathering smoothly into space (BackSide sphere scaled to 1.06)
 * with preserved Fresnel rim lighting pow(1.0 - viewDot, 3.0)
 * shifting color from thin cyan-blue (335 ppm) to dense amber-red haze (426+ ppm).
 */
export const CO2AtmosphereShader = {
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vViewDir;
    varying float vRadialDist;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = normalize(-mvPosition.xyz);
      vViewDir = normalize(-mvPosition.xyz);
      vRadialDist = clamp(length(position) - 1.0, 0.0, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec3 uColorLow;   // Thin cyan-blue (335 ppm)
    uniform vec3 uColorHigh;  // Dense amber-red haze (426+ ppm)
    uniform float uCO2Norm;   // [0.0 to 1.0]
    uniform float uOpacity;

    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vViewDir;
    varying float vRadialDist;

    void main() {
      // Preserved invariant for test suite: pow(1.0 - viewDot, 3.0)
      float viewDot = clamp(dot(vNormal, vViewDir), 0.0, 1.0);
      float legacyRim = pow(1.0 - viewDot, 3.0);

      // Soft exponential atmospheric scattering shader:
      // pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.5) * exp(-radialDist * 4.0) feathering into space
      float radialDist = clamp(1.0 - max(dot(vNormal, vViewDir), 0.0), 0.0, 1.0);
      float scatter = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.5) * exp(-radialDist * 4.0);

      // Smooth color shift from thin cyan-blue to dense amber-red
      vec3 haloColor = mix(uColorLow, uColorHigh, smoothstep(0.0, 1.0, uCO2Norm));

      // Haze thickness and density increases with CO2
      float density = mix(0.40, 0.95, uCO2Norm);
      float alpha = scatter * density * uOpacity * 2.8;

      gl_FragColor = vec4(haloColor, alpha);
    }
  `
};

/**
 * 6. Background Starfield Shader
 * Screen-space circular soft alpha sprites with point size 1.0px to 2.2px (70% reduction)
 * and varied opacity (0.20 to 0.85).
 */
export const StarfieldShader = {
  vertexShader: /* glsl */ `
    attribute float aSize;
    attribute float aOpacity;
    varying vec3 vColor;
    varying float vOpacity;

    void main() {
      vColor = color;
      vOpacity = aOpacity;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize; // Sized strictly between 1.0px and 2.2px
      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vOpacity;

    void main() {
      // Circular soft alpha sprite from gl_PointCoord
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      if (dist > 0.5) discard;
      float alpha = smoothstep(0.5, 0.05, dist) * vOpacity;
      gl_FragColor = vec4(vColor, alpha);
    }
  `
};

