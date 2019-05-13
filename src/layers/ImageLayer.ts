import { Matrix4x4 } from '../utils/linalg';
import cachedFunction from '../utils/cached-function';
import { Image } from '../utils/image-loading';
import Layer, { Input, LossFunction } from './Layer';

enum DrawMode {
  LDR = 0,
  HDR = 1,
  ColorMap = 2,
}

enum ViewTransform {
  None = -1,
  Gamma22 = 0,
  K1S1 = 1,
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
uniform int mode;
uniform int nChannels;
uniform int lossFunction;
uniform int imageHeight; // Height and width are used to access neighboring pixels
uniform int imageWidth;
varying vec2 vTextureCoord;
uniform sampler2D imASampler;
uniform sampler2D imBSampler;
uniform sampler2D cmapSampler;

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

void main(void) {
    vec3 col;
    vec2 position = vec2(vTextureCoord.s, vTextureCoord.t);
    if (lossFunction == ${LossFunction.L1}) {
        col = texture2D(imASampler, position).rgb;
        col = col - texture2D(imBSampler, position).rgb;
        col = abs(col);
    } else if (lossFunction == ${LossFunction.MAPE}) {
        vec3 img = texture2D(imASampler, position).rgb;
        vec3 ref = texture2D(imBSampler, position).rgb;
        vec3 diff = img - ref;
        col = abs(diff) / (abs(ref) + 1e-2);
    } else if (lossFunction == ${LossFunction.SMAPE}) {
        vec3 img = texture2D(imASampler, position).rgb;
        vec3 ref = texture2D(imBSampler, position).rgb;
        vec3 diff = img - ref;
        col = 2.0 * abs(diff) / (abs(ref) + abs(img) + 2e-2);
    } else if (lossFunction == ${LossFunction.MRSE}) {
        vec3 img = texture2D(imASampler, position).rgb;
        vec3 ref = texture2D(imBSampler, position).rgb;
        vec3 diff = img - ref;
        col = diff * diff / (ref * ref + 1e-4);
    } else if (lossFunction == ${LossFunction.L2}) {
        vec3 img = texture2D(imASampler, position).rgb;
        vec3 ref = texture2D(imBSampler, position).rgb;
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
  imageWidth: WebGLUniformLocation;
  imageHeight: WebGLUniformLocation;
}

export interface TonemappingSettings {
  viewTransform: number;
  offset: number;
  gamma: number;
  exposure: number;
}
const defaultTonemapping: TonemappingSettings = { viewTransform:0.0, exposure: 1.0, gamma: 1.0, offset: 0.0 };

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

  constructor(canvas: HTMLCanvasElement, image: Input) {
    super(canvas, image);

    // Make sure 'this' is available even when these methods are passed as a callback
    this.checkRender = this.checkRender.bind(this);
    this.invalidate  = this.invalidate.bind(this);

    this.initWebGl(canvas);

    // Create a texture cache and load the image texture
    this.getTexture = cachedFunction(this.createTexture.bind(this));

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
      imageWidth: getUniformLocation('imageWidth'),
      imageHeight: getUniformLocation('imageHeight'),
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
