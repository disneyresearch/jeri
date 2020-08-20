import { Matrix4x4 } from '../utils/linalg';
import cachedFunction from '../utils/cached-function';
import { Image } from '../utils/image-loading';
import Layer, { Input, LossFunction } from './Layer';

export enum DrawMode {
  LDR = 0,
  HDR = 1,
  ColorMap = 2,
}

export enum ViewTransform {
  None = 0,
  Gamma22 = 1,
  K1S1 = 2,
  Size = 3 // not a real view transform
}

const vertexShaderSource = `
attribute vec3 aVertexPosition;
attribute vec2 aTextureCoord;
varying vec2 vTextureCoord;
uniform mat4 viewMatrix;
void main(void) {
    gl_Position = viewMatrix * vec4(aVertexPosition, 1.0);
    vTextureCoord = aTextureCoord;
}`;

const fragmentShaderSource = `
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
const int filterRadius = 5;
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
}`;

const imageVertices = new Float32Array([
  // X   Y     Z      U    V
  -1.0, -1.0,  0.0,   0.0, 1.0,
  -1.0,  1.0,  0.0,   0.0, 0.0,
   1.0, -1.0,  0.0,   1.0, 1.0,
   1.0,  1.0,  0.0,   1.0, 0.0,
]);

const colorMapTexels = new Uint8Array([
  0, 0, 3, 255,
  23, 15, 60, 255,
  67, 15, 117, 255,
  113, 31, 129, 255,
  158, 46, 126, 255,
  205, 63, 112, 255,
  240, 96, 93, 255,
  253, 149, 103, 255,
  254, 201, 141, 255,
  251, 252, 191, 255,
]);

function compileShader(code: string, type: number, gl: WebGLRenderingContext): WebGLShader {
    var shader = gl.createShader(type);
    if (!shader) {
        throw new Error(`Creating shader failed with error.`);
    }
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Compiling shader failed with error '${gl.getShaderInfoLog(shader)}'.`);
    }
    return shader;
}

interface WebGlAttributes {
  vertexPosition: number;
  vertexTextureCoordinate: number;
}

interface WebGlUniforms {
  drawMode: WebGLUniformLocation;
  lossFunction: WebGLUniformLocation;
  nChannels: WebGLUniformLocation;
  viewMatrix: WebGLUniformLocation;
  imASampler: WebGLUniformLocation;
  imBSampler: WebGLUniformLocation;
  cmapSampler: WebGLUniformLocation;
  viewTransform: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  offset: WebGLUniformLocation;
  gamma: WebGLUniformLocation;
  hdrClip: WebGLUniformLocation;
  hdrGamma: WebGLUniformLocation;
  rgb2xyzMatrix: WebGLUniformLocation;
  imageWidth: WebGLUniformLocation;
  imageHeight: WebGLUniformLocation;
  edgeFilter: WebGLUniformLocation;
  pointFilter: WebGLUniformLocation;
}

export interface TonemappingSettings {
  viewTransform: number;
  offset: number;
  gamma: number;
  exposure: number;
  hdrClip: number;
  hdrGamma: number;
  angularResolution: number;
}
const defaultTonemapping: TonemappingSettings = {
  viewTransform:0.0,
  exposure: 1.0,
  gamma: 1.0,
  offset: 0.0,
  hdrClip: 1024.0,
  hdrGamma: 1.0,
  angularResolution: 2,
};

export type TextureCache = (image: Image) => WebGLTexture;

/**
 * Image Layer
 */
export default class ImageLayer extends Layer {
  private tonemappingSettings: TonemappingSettings = defaultTonemapping;

  private needsRerender: boolean = true;
  private getTexture: TextureCache;

  private gl: WebGLRenderingContext;
  private glAttributes: WebGlAttributes;
  private glUniforms: WebGlUniforms;
  private quadVertexBuffer: WebGLBuffer;
  private cmapTexture: WebGLTexture;
  private rgb2xyzMatrix: Float32Array;

  constructor(canvas: HTMLCanvasElement, image: Input) {
    super(canvas, image);

    // Make sure 'this' is available even when these methods are passed as a callback
    this.checkRender = this.checkRender.bind(this);
    this.invalidate  = this.invalidate.bind(this);

    this.initWebGl(canvas);

    // Create a texture cache and load the image texture
    this.getTexture = cachedFunction(this.createTexture.bind(this));

    // From https://mina86.com/2019/srgb-xyz-matrix/
    // sRGB primaries, D65 whitepoint
    this.rgb2xyzMatrix = new Float32Array([
      10135552.0 / 24577794.0,  8788810.0 / 24577794.0,   4435075.0 / 24577794.0,
       2613072.0 / 12288897.0,  8788810.0 / 12288897.0,    887015.0 / 12288897.0,
       1425312.0 / 73733382.0,  8788810.0 / 73733382.0,  70074185.0 / 73733382.0,
    ]);

    // Draw for the first time
    this.needsRerender = true;
    requestAnimationFrame(this.checkRender);
  }

  setTransformation(transformation: Matrix4x4) {
    this.transformation = transformation;
    this.invalidate();
  }

  setTonemapping(tonemapping: TonemappingSettings) {
    this.tonemappingSettings = tonemapping;
    this.invalidate();
  }

  setImage(image: Input) {
    this.image = image;
    this.invalidate();
  }

  /**
   * Force a new draw the next frame
   */
  invalidate() {
    this.needsRerender = true;
  }

  /**
   * Render loop, will draw when this component is invalidated with
   * this.needsRerender = true;
   * or when the size of the container changed
   */
  private checkRender() {
    if (this.resize() || this.needsRerender) {
      this.needsRerender = false;
      this.draw();
    }
    requestAnimationFrame(this.checkRender);
  }

  private normalizeFilter(filter: number[]) {
    let sumPositive: number = 0;
    let sumNegative: number = 0;
    for (let w of filter) {
      if (w > 0)
        sumPositive += w;
      else
        sumNegative += -w;
    }
    for (let wk in filter) {
      if (filter[wk] > 0)
        filter[wk] /= sumPositive;
      else
        filter[wk] /= sumNegative;
    }
  }

  private genFilter(angularResolution: number, radius: number) {
    const w = 0.082;
    let sd = 0.5 * w * angularResolution;
    if (radius < Math.ceil(3.0*sd)) {
      console.warn('Filter Radius might be too small for kernel');
    }
    let edgeFilter = [];
    let pointFilter = [];
    for (let y = -radius; y < radius + 1; ++y) {
      for (let x = -radius; x < radius + 1; ++x) {
        let g = Math.exp(-(x**2 + y**2) / (2 * sd**2));
        edgeFilter.push(g * x);
        pointFilter.push(g * (x**2/(sd**2) - 1));
      }
    }
    this.normalizeFilter(edgeFilter);
    this.normalizeFilter(pointFilter);
    return {
      radius: radius,
      edge: new Float32Array(edgeFilter),
      point: new Float32Array(pointFilter)
    };
  }

  /**
   * Paint a new image
   */
  private draw() {
    if (!this.cmapTexture) {
      throw new Error('Textures need to be initialized before calling draw()');
    }
    this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);

    this.gl.uniform1i(this.glUniforms.viewTransform, this.tonemappingSettings.viewTransform);
    this.gl.uniform1f(this.glUniforms.exposure, this.tonemappingSettings.exposure);
    this.gl.uniform1f(this.glUniforms.offset, this.tonemappingSettings.offset);
    this.gl.uniform1f(this.glUniforms.gamma, this.tonemappingSettings.gamma);
    this.gl.uniform1f(this.glUniforms.hdrClip, this.tonemappingSettings.hdrClip);
    this.gl.uniform1f(this.glUniforms.hdrGamma, this.tonemappingSettings.hdrGamma);
    this.gl.uniformMatrix3fv(this.glUniforms.rgb2xyzMatrix, false, this.rgb2xyzMatrix);
    let filter = this.genFilter(this.tonemappingSettings.angularResolution, 5);
    this.gl.uniform1fv(this.glUniforms.edgeFilter, filter.edge);
    this.gl.uniform1fv(this.glUniforms.pointFilter, filter.point);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT); // tslint:disable-line

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVertexBuffer);
    this.gl.vertexAttribPointer(
      this.glAttributes.vertexPosition,
      3,
      this.gl.FLOAT,
      false,
      5 * imageVertices.BYTES_PER_ELEMENT,
      0
    );
    this.gl.vertexAttribPointer(
      this.glAttributes.vertexTextureCoordinate,
      2,
      this.gl.FLOAT,
      false,
      5 * imageVertices.BYTES_PER_ELEMENT, // stride
      3 * imageVertices.BYTES_PER_ELEMENT  // offset
    );

    this.gl.uniform1i(this.glUniforms.imageHeight, this.image.height);
    this.gl.uniform1i(this.glUniforms.imageWidth, this.image.width);

    if (this.image.type === 'Difference') {
      this.gl.uniform1i(this.glUniforms.drawMode, DrawMode.ColorMap);
      this.gl.uniform1i(this.glUniforms.lossFunction, this.image.lossFunction);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.getTexture(this.image.imageA));
      this.gl.uniform1i(this.glUniforms.imASampler, 0);
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.getTexture(this.image.imageB));
      this.gl.uniform1i(this.glUniforms.imBSampler, 1);
    } else {
      if (this.image.nChannels === 1) {
        this.gl.uniform1i(this.glUniforms.drawMode, DrawMode.ColorMap);
      } else if (this.image.type === 'HdrImage') {
        this.gl.uniform1i(this.glUniforms.drawMode, DrawMode.HDR);
      } else {
        this.gl.uniform1i(this.glUniforms.drawMode, DrawMode.LDR);
      }
      this.gl.uniform1i(this.glUniforms.lossFunction, 0);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.getTexture(this.image));
      this.gl.uniform1i(this.glUniforms.imASampler, 0);
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.getTexture(this.image));
      this.gl.uniform1i(this.glUniforms.imBSampler, 1);
    }

    this.gl.activeTexture(this.gl.TEXTURE2);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.cmapTexture);
    this.gl.uniform1i(this.glUniforms.cmapSampler, 2);

    this.gl.uniform1i(this.glUniforms.nChannels, this.image.nChannels);

    const viewMatrix = this.getViewMatrix();
    this.gl.uniformMatrix4fv(this.glUniforms.viewMatrix, false, viewMatrix.data);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private initWebGl(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl') as WebGLRenderingContext;

    if (!this.gl) {
      throw new Error('Please upgrade your browser to one that supports WebGL.');
    }

    if (!this.gl.getExtension('OES_texture_float')) {
      throw new Error('Your browser does not supports WebGL FLoating Point Textures.');
    }

    this.gl.clearColor(0.25, 0.25, 0.25, 1.0);
    this.gl.enable(this.gl.DEPTH_TEST);

    const program = this.initShaders();
    this.quadVertexBuffer = this.initQuadVertexBuffer();
    this.glAttributes = this.initAttributes(program);
    this.glUniforms = this.initUniforms(program);
    this.cmapTexture = this.initCmapTexture();
  }

  private initShaders(): WebGLProgram {
    const vertexShader = compileShader(vertexShaderSource, this.gl.VERTEX_SHADER, this.gl);
    const fragmentShader = compileShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER, this.gl);

    const program = this.gl.createProgram();
    if (vertexShader && fragmentShader && program) {
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
    }
    if (!program || !this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        throw new Error('Failed to link the program.');
    }
    this.gl.useProgram(program);
    return program;
  }

  private initCmapTexture(): WebGLTexture {
    const cmapTexture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, cmapTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      colorMapTexels.length / 4,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      colorMapTexels
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    if (!cmapTexture) {
      throw new Error('Failed to initialize color map texture.');
    }
    return cmapTexture;
  }

  private initQuadVertexBuffer(): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, imageVertices, this.gl.STATIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    if (!buffer) {
      throw new Error('Failed to initialize quad vertex buffer.');
    }
    return buffer;
  }

  private initAttributes(program: WebGLProgram): WebGlAttributes {
    const attributes = {
      vertexPosition: this.gl.getAttribLocation(program, 'aVertexPosition'),
      vertexTextureCoordinate: this.gl.getAttribLocation(program, 'aTextureCoord'),
    };
    this.gl.enableVertexAttribArray(attributes.vertexPosition);
    this.gl.enableVertexAttribArray(attributes.vertexTextureCoordinate);
    return attributes;
  }

  private initUniforms(program: WebGLProgram) {
    let getUniformLocation = (name: string) => {
      let location = this.gl.getUniformLocation(program, name);
      if (!location) {
        throw new Error(`Failed to get uniform location for '${name}'.`);
      }
      return location;
    };
    return {
      drawMode: getUniformLocation('mode'),
      lossFunction: getUniformLocation('lossFunction'),
      nChannels: getUniformLocation('nChannels'),
      viewMatrix: getUniformLocation('viewMatrix'),
      imASampler: getUniformLocation('imASampler'),
      imBSampler: getUniformLocation('imBSampler'),
      cmapSampler: getUniformLocation('cmapSampler'),
      viewTransform: getUniformLocation('viewTransform'),
      exposure: getUniformLocation('exposure'),
      offset: getUniformLocation('offset'),
      gamma: getUniformLocation('gamma'),
      hdrClip: getUniformLocation('hdrClip'),
      hdrGamma: getUniformLocation('hdrGamma'),
      rgb2xyzMatrix: getUniformLocation('rgb2xyzMatrix'),
      imageWidth: getUniformLocation('imageWidth'),
      imageHeight: getUniformLocation('imageHeight'),
      edgeFilter: getUniformLocation('edgeFilter'),
      pointFilter: getUniformLocation('pointFilter'),
    };
  }

  private createTexture(image: Image): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to initialize image texture');
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    if (image.type === 'HdrImage') {
      if (image.nChannels === 1) {
          this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.LUMINANCE,
            image.width,
            image.height,
            0,
            this.gl.LUMINANCE,
            this.gl.FLOAT,
            image.data
          );
      } else if (image.nChannels === 3) {
          this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGB,
            image.width,
            image.height,
            0,
            this.gl.RGB,
            this.gl.FLOAT,
            image.data
          );
      } else {
        throw new Error(`Don't know what to do with ${image.nChannels} image channels.`);
      }
    } else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        image.data
      );
    }
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    return texture;
  }
}
