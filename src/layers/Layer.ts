import { Matrix4x4 } from '../utils/linalg';
import { Image } from '../utils/image-loading';

export interface ImageDifference {
  type: 'Difference';
  imageA: Image;
  imageB: Image;
  width: number;
  height: number;
  nChannels: number;
  lossFunction: LossFunction;
}

export type Input = Image | ImageDifference;

export default class Layer {
  protected transformation: Matrix4x4 = Matrix4x4.create();

  private aspectMatrixBuffer: Matrix4x4 = Matrix4x4.create(); // To prevent memory allocation in the render loop
  private viewMatrixBuffer: Matrix4x4 = Matrix4x4.create(); // To prevent memory allocation in the render loop

  constructor(protected canvas: HTMLCanvasElement, protected image: Input) {
    this.image = image;
    this.resize();
  }

  /**
   * Resize the canvas size if its elements size in the browser changed
   * @return whether anything changed
   */
  protected resize(): boolean {
    const width = Math.floor(this.canvas.clientWidth * window.devicePixelRatio);
    const height = Math.floor(this.canvas.clientHeight * window.devicePixelRatio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      return true;
    }
    return false;
  }

  /**
   * Compute the scalings in X and Y make sure the (-1,1) x (-1,1) box has the aspect ratio of the image
   * and is positioned centerally in the canvas
   */
  protected getAspect(): {x: number, y: number} {
    const viewAspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const textAspect = this.image.width / this.image.height;
    let aspect: { x: number, y: number };
    if (viewAspect > textAspect) {
      aspect = { x: textAspect / viewAspect, y: 1.0 };
    } else {
      aspect = { x: 1.0, y: viewAspect / textAspect };
    }
    return aspect;
  }

  /**
   * Compute the view matrix from the current transformation and the shape of the window
   */
  protected getViewMatrix(): Matrix4x4 {
    const aspect = this.getAspect();
    Matrix4x4.fromScaling(this.aspectMatrixBuffer, [aspect.x, aspect.y, 1.0]);
    Matrix4x4.multiply(this.viewMatrixBuffer, this.aspectMatrixBuffer, this.transformation);
    return this.viewMatrixBuffer;
  }
}

export enum LossFunction {
  L1 = 1,
  L2 = 2,
  MAPE = 3,
  MRSE = 4,
  SMAPE = 5,
  SSIM = 6,
}

const lossFunctions = {
  'L1': LossFunction.L1,
  'L2': LossFunction.L2,
  'MAPE': LossFunction.MAPE,
  'MRSE': LossFunction.MRSE,
  'SMAPE': LossFunction.SMAPE,
  'SSIM': LossFunction.SSIM,
};

export function lossFunctionFromString(name: string): LossFunction {
  if (lossFunctions.hasOwnProperty(name)) {
    return lossFunctions[name];
  } else {
    throw Error(`Loss function ${name} is invalid. Available options: ${Object.keys(lossFunctions)}`);
  }
}
