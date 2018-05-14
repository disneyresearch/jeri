import { Matrix4x4, Vector4 } from '../utils/linalg';
import Layer, { Input } from './Layer';
const normalizeWheel = require('normalize-wheel');

const SCROLL_FACTOR = 1.001;

/**
 * Mouse Layer
 * @todo add some proper documentation
 */
export default class MouseLayer extends Layer {
  private pointCallback?: Function;
  private transformationCallback?: (t: Matrix4x4) => void;
  private panningState: null | { transformationAtStart: Matrix4x4, previousMouse: { x: number, y: number } } = null;
  private unsubscribeFunctions: Function[] = []; /** To be called on destruct */

  private enableMouseEvents: boolean;

  constructor(canvas: HTMLCanvasElement, image: Input, enableMouseEvents: boolean) {
    super(canvas, image);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
    this.handlePointReporting = this.handlePointReporting.bind(this);

    this.enableMouseEvents = enableMouseEvents;

    // Subscribe to changes in the layers reactive inputs and window size
    let unsubscribe;
    document.addEventListener('mouseup', this.handleMouseUp);
    unsubscribe = document.removeEventListener.bind(document, 'mouseup', this.handleMouseUp);
    this.unsubscribeFunctions.push(unsubscribe);

    document.addEventListener('mousemove', this.handleMouseMove);
    unsubscribe = document.removeEventListener.bind(document, 'mousemove', this.handleMouseMove);
    this.unsubscribeFunctions.push(unsubscribe);

    canvas.addEventListener('wheel', this.handleScroll);
    unsubscribe = canvas.removeEventListener.bind(canvas, 'wheel', this.handleScroll);
    this.unsubscribeFunctions.push(unsubscribe);

    canvas.addEventListener('mousedown', this.handleMouseDown);
    unsubscribe = canvas.removeEventListener.bind(canvas, 'mousedown', this.handleMouseDown);
    this.unsubscribeFunctions.push(unsubscribe);

    canvas.addEventListener('mousemove', this.handlePointReporting);
    unsubscribe = canvas.removeEventListener.bind(canvas, 'mousemove', this.handlePointReporting);
    this.unsubscribeFunctions.push(unsubscribe);
  }

  setTransformation(transformation: Matrix4x4, broadcast: boolean = false) {
    this.transformation = transformation;
    if (broadcast && this.transformationCallback != null) {
      this.transformationCallback(transformation);
    }
  }

  setEnableMouseEvents(enable: boolean) {
    this.enableMouseEvents = enable;
  }

  onTransformationChange(callback?: (t: Matrix4x4) => void) {
    this.transformationCallback = callback;
  }

  setImage(image: Input) {
    this.image = image;
  }

  onPointAt(callback?: Function) {
    this.pointCallback = callback;
  }

  destruct() {
    this.unsubscribeFunctions.forEach(fn => fn());
  }

  private handleMouseMove(event: MouseEvent) {
    if (!this.enableMouseEvents) {
      return;
    }
    if (this.panningState) {
      const { x, y } = this.relativeMousePosition(event.clientX, event.clientY);
      const dx = x - this.panningState.previousMouse.x;
      const dy = y - this.panningState.previousMouse.y;
      const transformation = Matrix4x4.create();
      const aspect = this.getAspect();
      Matrix4x4.translate(transformation, transformation, [dx / aspect.x, dy / aspect.y, 0.0]);
      Matrix4x4.multiply(transformation, transformation, this.transformation);
      this.setTransformation(transformation, true);
      this.panningState.previousMouse = { x, y };
    }
  }

  private handleMouseUp(event: MouseEvent) {
    if (this.panningState) {
      this.panningState = null;
    }
  }

  private handleMouseDown(event: MouseEvent) {
    const mousePosition = this.relativeMousePosition(event.clientX, event.clientY);
    this.panningState = {
      transformationAtStart: Matrix4x4.clone(this.transformation),
      previousMouse: mousePosition,
    };
  }

  private handleScroll(event: WheelEvent) {
    if (!this.enableMouseEvents) {
      return;
    }
    event.preventDefault();
    const {pixelY} = normalizeWheel(event);
    const mouse = this.relativeMousePosition(event.clientX, event.clientY);
    const transformation = Matrix4x4.create();
    const deltaMatrix = Matrix4x4.create();
    const aspect = this.getAspect();
    Matrix4x4.translate(deltaMatrix, deltaMatrix, [mouse.x / aspect.x, mouse.y / aspect.y, 0.0]);
    const scaleFactor = Math.pow(SCROLL_FACTOR, pixelY);
    Matrix4x4.scale(deltaMatrix, deltaMatrix, [scaleFactor, scaleFactor, 1.0]);
    Matrix4x4.translate(deltaMatrix, deltaMatrix, [-mouse.x / aspect.x, -mouse.y / aspect.y, 0.0]);
    Matrix4x4.multiply(transformation, deltaMatrix, this.transformation);
    this.setTransformation(transformation, true);
  }

  /**
   * Event handler for reporting mouse movement.
   *
   * Only applicable when the options 'onPoint' property is set on this component.
   */
  private handlePointReporting(event: MouseEvent): void {
    if (this.pointCallback) {
      if (!this.panningState) {
        const { x, y } = this.relativeMousePosition(event.clientX, event.clientY);
        const imageCoordinates = this.canvasToImage(x, y);
        this.pointCallback(imageCoordinates.x, imageCoordinates.y);
      }
    }
  }

  /**
   * Translate clientX and clientY values to relative positions within the bounding box
   * of the viewer.
   */
  private relativeMousePosition(clientX: number, clientY: number): { x: number, y: number } {
    const { clientWidth, clientHeight } = this.canvas;
    const { left, top } = this.canvas.getBoundingClientRect();
    return {
      x: -1.0 + 2.0 * (clientX - left) / clientWidth,
      y:  1.0 - 2.0 * (clientY - top) / clientHeight,
    };
  }

  /**
   * Translate canvas coordinates to image coodrinates
   */
  private canvasToImage(x: number, y: number): { x: number, y: number } {
      const point = Vector4.create();
      Vector4.set(point, x, y, 1.0, 1.0);
      const inverseViewMatrix = Matrix4x4.create();
      const viewMatrix = this.getViewMatrix();
      Matrix4x4.invert(inverseViewMatrix, viewMatrix);
      Vector4.transformMat4(point, point, inverseViewMatrix);
      return { x: point.data[0], y: point.data[1] };
  }
}
