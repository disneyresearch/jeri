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

let vertexShaderSource : string = require('!!raw-loader?esModule=false!../shaders/vertex.glsl');
let fragmentShaderSource : string = require('!!raw-loader?esModule=false!../shaders/frag.glsl');

const flipFilterRadius = 3; // must be kept in sync with the frag.glsl

interface FlipFilter {
  angularResolution: number;
  radius: number;
  edge: Float32Array;
  point: Float32Array;
};

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

    for (let l in LossFunction) {
      code = code.replace('${LossFunction.' + LossFunction[l] + '}', l);
    }
    for (let l in DrawMode) {
      code = code.replace('${DrawMode.' + DrawMode[l] + '}', l);
    }
    for (let l in ViewTransform) {
      code = code.replace('${ViewTransform.' + ViewTransform[l] + '}', l);
    }

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
  private flipFilter: FlipFilter;

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

    this.flipFilter = this.genFilter(this.tonemappingSettings.angularResolution, flipFilterRadius);

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
      angularResolution: angularResolution,
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
      if (this.flipFilter.angularResolution != this.tonemappingSettings.angularResolution)
        this.flipFilter = this.genFilter(this.tonemappingSettings.angularResolution, flipFilterRadius);
      this.gl.uniform1fv(this.glUniforms.edgeFilter, this.flipFilter.edge);
      this.gl.uniform1fv(this.glUniforms.pointFilter, this.flipFilter.point);
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
