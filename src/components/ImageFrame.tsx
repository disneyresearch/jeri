import * as React from 'react';
import { Matrix4x4 } from '../utils/linalg';

import ImageLayer from '../layers/ImageLayer';
import TextLayer from '../layers/TextLayer';
import MouseLayer from '../layers/MouseLayer';
import { Input as ImageInput } from '../layers/Layer';

import styled from 'styled-components';

const StretchingCanvas = styled.canvas`
  position: absolute;
  top: 0; bottom: 0;
  left: 0; right: 0;
  width: 100%; height: 100%;
`;
const StretchingDiv = styled.div`
  position: absolute;
  top: 0; bottom: 0;
  left: 0; right: 0;
  width: 100%; height: 100%;
`;

export interface ImageFrameProps {
    image: ImageInput;
    viewTransform: number;
    exposure: number;
    gamma: number;
    offset: number;
    allowMovement: boolean;
    /** Optional callback to be called when the mouse moves */
    onPoint?: (x: number, y: number) => void;
    /** Optional callback to be called when the canvas is panned or zoomed */
    onTransform?: (transformation: Matrix4x4) => void;
    enableMouseEvents: boolean;
}

/**
 * An image frame that deals with mouse movement for padding and zooming
 */
export default class ImageFrame extends React.Component<ImageFrameProps, {}> {
  private imageLayerElement: HTMLCanvasElement;
  private textLayerElement: HTMLCanvasElement;
  private mouseLayerElement: HTMLCanvasElement;

  private imageLayer: ImageLayer;
  private textLayer: TextLayer;
  private mouseLayer: MouseLayer;

  private transformation: Matrix4x4 = Matrix4x4.create();

  /** Where to go back when reset() is called */
  private defaultTransformation: Matrix4x4 = Matrix4x4.create();

  constructor(props: ImageFrameProps) {
    super(props);
    this.handleTransformationChange = this.handleTransformationChange.bind(this);
  }

  componentDidMount() {
    this.imageLayer = new ImageLayer(this.imageLayerElement, this.props.image);
    this.textLayer = new TextLayer(this.textLayerElement, this.props.image);
    this.mouseLayer = new MouseLayer(this.mouseLayerElement, this.props.image, this.props.enableMouseEvents);

    this.mouseLayer.onTransformationChange(this.handleTransformationChange);

    this.updateCanvasProps();
    this.handleTransformationChange(this.transformation);
  }

  componentDidUpdate(prevProps: ImageFrameProps) {
    this.updateCanvasProps(prevProps);
    this.mouseLayer.setEnableMouseEvents(this.props.enableMouseEvents);
  }

  componentWillUnmount() {
    this.mouseLayer.onPointAt(undefined);
    this.mouseLayer.onTransformationChange(undefined);
    this.mouseLayer.destruct();
  }

  /** Set the default transformation that calling reset() will result in */
  setDefaultTransformation(transformation: Matrix4x4) {
    this.defaultTransformation = transformation;
  }

  reset() {
    this.handleTransformationChange(this.defaultTransformation);
  }

  setTransformation(transformation: Matrix4x4) {
    this.handleTransformationChange(transformation);
  }

  getTransformation(): Matrix4x4 {
    return this.transformation;
  }

  render() {
    return (
      <StretchingDiv>
        <StretchingCanvas innerRef={(x) => this.imageLayerElement = x} />
        <StretchingCanvas innerRef={(x) => this.textLayerElement = x} />
        <StretchingCanvas innerRef={(x) => this.mouseLayerElement = x} />
      </StretchingDiv>
    );
  }

  private handleTransformationChange(transformation: Matrix4x4) {
    if (this.props.allowMovement) {
      this.transformation = transformation;
      this.imageLayer.setTransformation(transformation);
      this.textLayer.setTransformation(transformation);
      this.mouseLayer.setTransformation(transformation);
      if (this.props.onTransform != null) {
        this.props.onTransform(transformation);
      }
    }
  }

  private updateCanvasProps(previousProps: ImageFrameProps | null = null) {
    if (!previousProps ||
        previousProps.viewTransform !== this.props.viewTransform ||
        previousProps.exposure !== this.props.exposure ||
        previousProps.gamma !== this.props.gamma ||
        previousProps.offset !== this.props.offset) {
      this.imageLayer.setTonemapping({
        viewTransform: this.props.viewTransform,
        exposure: this.props.exposure,
        offset: this.props.offset,
        gamma: this.props.gamma
      });
    }
    if (!previousProps || previousProps.image !== this.props.image) {
      this.imageLayer.setImage(this.props.image);
      this.textLayer.setImage(this.props.image);
      this.mouseLayer.setImage(this.props.image);
    }
    this.mouseLayer.onPointAt(this.props.onPoint);
  }
}
