import { Matrix4x4, Vector4 } from '../utils/linalg';
import Layer, { Input } from './Layer';
import { getPixelColor } from '../utils/image-loading';

export default class TextLayer extends Layer {
  protected image: Input;

  private context: CanvasRenderingContext2D;
  private needsRerender: boolean = true;

  constructor(canvas: HTMLCanvasElement, image: Input) {
    super(canvas, image);
    // Create canvas 2d drawing context
    const context = canvas.getContext('2d');
    if (context == null) {
        throw new Error('Failed to create 2D context for TextOverlay');
    }
    this.context = context;

    // Make sure 'this' is available even when these methods are passed as callbacks
    this.checkRender = this.checkRender.bind(this);
    this.invalidate  = this.invalidate.bind(this);

    // Draw for the first time
    this.needsRerender = true;
    requestAnimationFrame(this.checkRender);
  }

  setTransformation(transformation: Matrix4x4) {
    this.transformation = transformation;
    this.invalidate();
  }

  setImage(image: Input) {
    this.image = image;
    this.invalidate();
  }

  /**
   * Force a new draw
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
   * Paint a new overlay
   */
  private draw() {
    const canvas = this.context.canvas;
    let leftTop = Vector4.fromValues(-1, 1, 0.0, 1.0);
    let rightBottom = Vector4.fromValues(1, -1, 0.0, 1.0);

    const mvMatrix = this.getViewMatrix();
    let invMvMatrix = Matrix4x4.create();
    Matrix4x4.invert(invMvMatrix, mvMatrix);

    const image = this.image;

    Vector4.transformMat4(leftTop, leftTop, invMvMatrix);
    Vector4.transformMat4(rightBottom, rightBottom, invMvMatrix);
    this.convertClipToRaster(leftTop, leftTop, image.width, image.height);
    this.convertClipToRaster(rightBottom, rightBottom, image.width, image.height);

    const px = Math.floor(leftTop.data[0]);
    const py = Math.floor(leftTop.data[1]);
    const qx = Math.floor(rightBottom.data[0]);
    const qy = Math.floor(rightBottom.data[1]);
    const lineHeight = Math.floor(20 * window.devicePixelRatio);
    const fontSize = Math.floor(16 * window.devicePixelRatio);
    const nx = canvas.width / (lineHeight * 3 + 2);
    const ny = canvas.height / (lineHeight * 3 + 2);

    this.context.clearRect(0, 0, canvas.width, canvas.height);

    if (image.type === 'Difference') {
      // We don't have access to computed values, so won't show the HUD
      return;
    }
    const zoomedInEnough = rightBottom.data[0] - leftTop.data[0] < nx && rightBottom.data[1] - leftTop.data[1] < ny;
    if (zoomedInEnough) {
      this.context.font = `${fontSize}px sans-serif`;
      for (let y = Math.max(0, py); y <= Math.min(image.height - 1, qy); y++) {
        for (let x = Math.max(0, px); x <= Math.min(image.width - 1, qx); x++) {
          Vector4.set(leftTop, x, y, 0.0, 1.0);
          this.convertRasterToClip(leftTop, leftTop, image.width, image.height);
          Vector4.transformMat4(leftTop, leftTop, mvMatrix);
          this.convertClipToRaster(leftTop, leftTop, canvas.width, canvas.height);
          let r, g, b;
          if (image.nChannels === 1) {
            r = getPixelColor(image, x, y, 0);
            this.context.fillStyle = '#888888';
            this.context.fillText(r.toFixed(4), leftTop.data[0], leftTop.data[1] + fontSize);
          } else {
            r = getPixelColor(image, x, y, 0);
            g = getPixelColor(image, x, y, 1);
            b = getPixelColor(image, x, y, 2);
            this.context.fillStyle = '#990000';
            this.context.fillText(r.toFixed(4), leftTop.data[0], leftTop.data[1] + fontSize);
            this.context.fillStyle = '#009900';
            this.context.fillText(g.toFixed(4), leftTop.data[0], leftTop.data[1] + fontSize + lineHeight);
            this.context.fillStyle = '#0000FF';
            this.context.fillText(b.toFixed(4), leftTop.data[0], leftTop.data[1] + fontSize + 2 * lineHeight);
          }
        }
      }
    }
  }

  /**
   * Convert coordinates from clip space to raster space
   * @param out coordinates in raster space (0, xres) x (0, yres)
   * @param a coordinates in clip space (-1,1) x (-1,1)
   * @param xres
   * @param yres
   */
  private convertClipToRaster(out: Vector4, a: Vector4, xres: number, yres: number) {
      out.data[0] = (a.data[0] + 1.0) * 0.5 * xres;
      out.data[1] = (1.0 - a.data[1]) * 0.5 * yres;
      return out;
  }

  /**
   * Convert coordinates from raster space to clip space
   * @param out coordinates in raster space (0, xres) x (0, yres)
   * @param a coordinates in clip space (-1,1) x (-1,1)
   * @param xres
   * @param yres
   */
  private convertRasterToClip(out: Vector4, a: Vector4, xres: number, yres: number) {
    out.data[0] = a.data[0] * 2.0 / xres - 1.0;
    out.data[1] = 1.0 - (a.data[1] * 2.0 / yres);
    return out;
  }
}
