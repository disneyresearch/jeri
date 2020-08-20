precision mediump float;
uniform int viewTransform;
uniform float exposure;
uniform float offset;
uniform float gamma;
uniform float hdrClip;
uniform float hdrGamma;
uniform int mode;
uniform int nChannels;
uniform int lossFunction;
uniform int imageHeight; // Height and width are used to access neighboring pixels
uniform int imageWidth;
varying vec2 vTextureCoord;
uniform sampler2D imASampler;
uniform sampler2D imBSampler;
uniform sampler2D cmapSampler;
uniform mat3 rgb2xyzMatrix;

// Flip Specific
const int filterRadius = 3;
const int filterDiameter = filterRadius * 2 + 1;
uniform float edgeFilter[filterDiameter*filterDiameter];
uniform float pointFilter[filterDiameter*filterDiameter];

vec3 lookupOffset(sampler2D sampler, vec2 position, vec2 offset) {
    // Read neighbouring pixels from an image texture
    // Takes 'position' (range 0 - 1) and an integer pixel offset 'offset'
    vec2 imageSize = vec2(imageWidth, imageHeight);
    return texture2D(sampler, position + offset / imageSize).rgb;
}

float log10(float a) {
  const float logBase10 = 1.0 / log2( 10.0 );

  return log2(a) * logBase10;
}

float luminance(vec3 rgb) {
  return dot(vec3(0.2126, 0.7152, 0.0722), rgb);
}

float hdrGammaTransform(float component, float e) {
    if (component > 1.0)
      return pow(component, e);
    return component;
}
vec3 preprocLossInput(vec3 colorRGB) {
  float e = 1.0 / hdrGamma;
  colorRGB.r = hdrGammaTransform(colorRGB.r, e);
  colorRGB.g = hdrGammaTransform(colorRGB.g, e);
  colorRGB.b = hdrGammaTransform(colorRGB.b, e);
  return clamp(colorRGB, 0.0, hdrClip);
}

vec3 GOG(vec3 rgb, float gain, float offset, float gamma) {
  return pow(gain * rgb + offset, vec3(1.0 / gamma));
}

float logEncodingLogC(float a) {
  float LogC = a >= 0.01059106816664 ? 0.385537 + 0.2471896 * log10(a * 5.555556 + 0.052272) : a * 5.367655 + 0.092809;

  return LogC;
}

float sigmoidK1S1(float a) {
  float sigmoid = 1.0 / (1.0 + pow(2.718281828459045, -8.9 * (a - 0.435)));

  return sigmoid;
}

vec3 viewTransformNone(vec3 rgb) {
  return rgb;
}

vec3 viewTransformGamma22(vec3 rgb) {
  const float exponent = 1.0 / 2.2;

  return pow(max(rgb, 0.0), vec3(exponent, exponent, exponent));
}

vec3 viewTransformK1S1(vec3 rgb) {
  vec3 LogC = vec3(logEncodingLogC(rgb.x), logEncodingLogC(rgb.y), logEncodingLogC(rgb.z));

  return vec3(sigmoidK1S1(LogC.x), sigmoidK1S1(LogC.y), sigmoidK1S1(LogC.z));
}

vec3 applyViewTransform(vec3 rgb, int which) {
  if (which == ${ViewTransform.None}) {
    return viewTransformNone(rgb);
  } else if (which == ${ViewTransform.Gamma22}) {
    return viewTransformGamma22(rgb);
  } else if (which == ${ViewTransform.K1S1}) {
    return viewTransformK1S1(rgb);
  }
}

const float labDelta = 6.0/29.0;
const float labDelta2 = labDelta * labDelta;
const float labDelta3 = labDelta * labDelta2;
float labGammaTransform(float f) {
  if (f > labDelta3) {
    return pow(f, 1.0/3.0);
  }
  else {
    return f / (3.0*labDelta2) + 4.0/29.0;
  }
}

vec3 xyz2Lab(vec3 colorXYZ) {
  // https://en.wikipedia.org/wiki/CIELAB_color_space#CIELAB%E2%80%93CIEXYZ_conversions
  vec3 whiteTS = rgb2xyzMatrix * vec3(1.0, 1.0, 1.0);
  vec3 normalizedXYZ = colorXYZ / whiteTS;

  // This must be possible more elegantly
  vec3 gammaXYZ = vec3(
    labGammaTransform(normalizedXYZ.x),
    labGammaTransform(normalizedXYZ.y),
    labGammaTransform(normalizedXYZ.z)
  );

  vec3 lab = vec3(
    116.0 * gammaXYZ.y - 16.0,
    500.0 * (gammaXYZ.x - gammaXYZ.y),
    200.0 * (gammaXYZ.y - gammaXYZ.z)
  );

  return lab;
}

float xyz2lum(vec3 colorXYZ) {
  vec3 whiteTS = rgb2xyzMatrix * vec3(1.0, 1.0, 1.0);
  return colorXYZ.y / whiteTS.y;
}

vec3 lab2hunt(vec3 colorLab) {
  // Desaturates dark colors, since their differences are less perceptible.
  float adjustment = min(0.01 * colorLab.x, 1.0);
  return vec3(colorLab.x, colorLab.yz * adjustment);
}

float diffHyab(vec3 aLab, vec3 bLab){
  vec3 delta = aLab - bLab;
  return abs(delta.x) + length(delta.yz);
}

float redistError(float deltaColor, float deltaMax) {
  // Exponentiate colors
  const float exponent = 0.7;
  deltaColor = pow(deltaColor, exponent);
  deltaMax = pow(deltaMax, exponent);

  // Set redistribution parameters
  const float pc = 0.4;
  const float pt = 0.95;
  float limit = pc * deltaMax;

  // Re-map error to 0-1 range. Values between 0 and
  // pc * max_error are mapped to the range [0, pt],
  if (deltaColor < limit) {
    return pt / limit * deltaColor;
  }
  else {
    return pt + ((deltaColor - limit) / (deltaMax - limit) * (1.0 - pt));
  }
}

vec4 featureDetection(sampler2D imSampler, vec2 position) {
  vec4 delta = vec4(0.0, 0.0, 0.0, 0.0);
  // Compute 2D Gaussian
  for (int y = 0; y < filterDiameter; ++y) {
    for (int x = 0; x < filterDiameter; ++x) {
      float dx = float(x - filterRadius);
      float dy = float(y - filterRadius);
      float L;
      vec3 rgb;
      // Normal
      rgb = preprocLossInput(lookupOffset(imSampler, position, vec2(dx, dy)));
      L = xyz2lum(rgb2xyzMatrix * rgb);
      delta[0] += L * edgeFilter[y * filterDiameter + x];
      delta[2] += L * pointFilter[y * filterDiameter + x];
      // Transposed
      delta[1] += L * edgeFilter[x * filterDiameter + y];
      delta[3] += L * pointFilter[x * filterDiameter + y];
    }
  }
  return delta;
}

vec3 flip_simplified(sampler2D imASampler, sampler2D imBSampler, vec2 position) {
  // Compute Color Loss
  vec3 aRGB = preprocLossInput(texture2D(imASampler, position).rgb);
  vec3 bRGB = preprocLossInput(texture2D(imBSampler, position).rgb);
  vec3 aXYZ = rgb2xyzMatrix * aRGB;
  vec3 bXYZ = rgb2xyzMatrix * bRGB;
  vec3 aLab = lab2hunt(xyz2Lab(aXYZ));
  vec3 bLab = lab2hunt(xyz2Lab(bXYZ));
  float deltaColor = diffHyab(aLab, bLab);

  // Normalize
  vec3 greenXYZ = rgb2xyzMatrix * vec3(0.0, 1.0, 0.0);
  vec3 blueXYZ = rgb2xyzMatrix * vec3(0.0, 0.0, 1.0);
  vec3 greenHunt = lab2hunt(xyz2Lab(greenXYZ));
  vec3 blueHunt = lab2hunt(xyz2Lab(blueXYZ));
  float deltaMax = diffHyab(greenHunt, blueHunt);
  deltaColor = redistError(deltaColor, deltaMax);

  // Structure
  vec4 featA = featureDetection(imASampler, position);
  vec4 featB = featureDetection(imBSampler, position);
  float deltaEdge = abs(length(featA.xy) - length(featB.xy));
  float deltaPoint = abs(length(featA.xy) - length(featB.xy));
  const float qf = 0.5;
  float deltaFeature = max(deltaEdge, deltaPoint);
  deltaFeature = pow((1.0 / sqrt(2.0)) * deltaFeature, qf);

  // Combine
  float deltaFlip = pow(deltaColor, 1.0 - deltaFeature);
  return vec3(deltaFlip, deltaFlip, deltaFlip);
}

void main(void) {
    vec3 col;
    vec2 position = vec2(vTextureCoord.s, vTextureCoord.t);
    if (lossFunction == ${LossFunction.L1}) {
        vec3 img = preprocLossInput(texture2D(imASampler, position).rgb);
        vec3 ref = preprocLossInput(texture2D(imBSampler, position).rgb);
        col = abs(img - ref);
    } else if (lossFunction == ${LossFunction.MAPE}) {
        vec3 img = preprocLossInput(texture2D(imASampler, position).rgb);
        vec3 ref = preprocLossInput(texture2D(imBSampler, position).rgb);
        vec3 diff = img - ref;
        col = abs(diff) / (abs(ref) + 1e-2);
    } else if (lossFunction == ${LossFunction.SMAPE}) {
        vec3 img = preprocLossInput(texture2D(imASampler, position).rgb);
        vec3 ref = preprocLossInput(texture2D(imBSampler, position).rgb);
        vec3 diff = img - ref;
        col = 2.0 * abs(diff) / (abs(ref) + abs(img) + 2e-2);
    } else if (lossFunction == ${LossFunction.MRSE}) {
        vec3 img = preprocLossInput(texture2D(imASampler, position).rgb);
        vec3 ref = preprocLossInput(texture2D(imBSampler, position).rgb);
        vec3 diff = img - ref;
        col = diff * diff / (ref * ref + 1e-4);
    } else if (lossFunction == ${LossFunction.L2}) {
        vec3 img = preprocLossInput(texture2D(imASampler, position).rgb);
        vec3 ref = preprocLossInput(texture2D(imBSampler, position).rgb);
        vec3 diff = img - ref;
        col = diff * diff;
    } else if (lossFunction == ${LossFunction.SSIM}) {
        const int windowRadius = 2; // We use a symmetric 5x5 window as opposed to the customary 8x8 (wiki)
        const float L = 1.; // The dynamic range
        const float k1 = 0.01, k2 = 0.03; // Default constants
        const float c1 = (k1*L)*(k1*L), c2 = (k2*L)*(k2*L);
        const float n = float((2 * windowRadius + 1) * (2 * windowRadius + 1));

        // Compute means and standard deviations of both images
        float aSum, aaSum, bSum, bbSum, abSum;
        for (int x = 0; x <= 2 * windowRadius; ++x) {
            for (int y = 0; y <= 2 * windowRadius; ++y) {
                vec2 offset = vec2(float(x - windowRadius), float(y - windowRadius));
                float a = luminance(applyViewTransform(lookupOffset(imASampler, position, offset), viewTransform));
                float b = luminance(applyViewTransform(lookupOffset(imBSampler, position, offset), viewTransform));
                aSum += a; bSum += b;
                aaSum += a * a; bbSum += b * b;
                abSum += a * b;
            }
        }
        float aMean = aSum / n, bMean = bSum / n;
        float aVar = (aaSum - n * aMean * aMean) / (n + 1.);
        float bVar = (bbSum - n * bMean * bMean) / (n + 1.);
        float abCovar = (abSum - n * aMean * bMean) / (n + 1.);

        float numerator = (2. * aMean * bMean + c1) * (2. * abCovar + c2);
        float denominator = (aMean * aMean + bMean * bMean + c1) * (aVar + bVar + c2);
        float ssim = numerator / denominator;
        col = vec3(1. - ssim, 1. - ssim, 1. - ssim);
    } else if (lossFunction == ${LossFunction.FLIP}) {
        // Simplified FLIP style loss, making a lot of assumptions
        col = flip_simplified(imASampler, imBSampler, position);
    } else {
        col = texture2D(imASampler, position).rgb;
        if (nChannels == 1) {
            col = vec3(col.r, col.r, col.r);
        }
    }

    if (mode == ${DrawMode.LDR}) {
        col = pow(col, vec3(2.2));
        col = GOG(col, exposure, offset, gamma);
        col = applyViewTransform(col, viewTransform);
    } else if (mode == ${DrawMode.HDR}) {
        col = GOG(col, exposure, offset, gamma);
        col = applyViewTransform(col, viewTransform);
    } else {
        float avg = (col.r + col.g + col.b) * 0.3333333333 * exposure;
        col = texture2D(cmapSampler, vec2(avg, 0.0)).rgb;
    }

    gl_FragColor = vec4(col, 1.0);
}
