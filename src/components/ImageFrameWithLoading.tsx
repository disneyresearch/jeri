import * as React from 'react';
import { Matrix4x4 } from '../utils/linalg';
import styled from 'styled-components';

import ImageFrame from './ImageFrame';
import { LossFunction, Input as ImageInput } from '../layers/Layer';
import { ImageCache } from '../utils/image-loading';

const StretchingDiv = styled.div`
  position: absolute;
  top: 0; bottom: 0;
  left: 0; right: 0;
  width: 100%; height: 100%;
`;

const LoadingOverlay = styled.div`
  display: block;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: left;
  padding: .6em;
  background-color: rgb(64, 64, 64);
`;

export interface ImageSpecUrl {
  type: 'Url';
  url: string;
  tonemapGroup: string;
}

export interface ImageSpecLossMap {
  type: 'Difference';
  lossFunction: LossFunction;
  urlA: string;
  urlB: string;
  tonemapGroup: string;
}

export type ImageSpec = ImageSpecUrl | ImageSpecLossMap;

export interface ImageFrameWithLoadingProps {
  imageSpec: ImageSpec;
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

export interface ImageFrameWithLoadingState {
  isLoading: boolean;
  errorMsg: string | null;
  image: ImageInput | null;
}

/**
 * A wrapper around ImageFrame that deals with the loading of images
 * It takes an `ImageSpec` instead of an `InputImage`.
 */
export default class ImageFrameWithLoading extends
  React.Component<ImageFrameWithLoadingProps, ImageFrameWithLoadingState> {

  public imageFrame: ImageFrame | null;

  private cache: ImageCache = new ImageCache();
  private requestId: number = 0;

  // Counter to ensure that returning downloads are still relevant to the current app state.
  private currentRequest: number = 0;

  constructor(props: ImageFrameWithLoadingProps) {
    super(props);
    this.state = {
      isLoading: false,
      errorMsg: null,
      image: null,
    };
    this.handleImageChange(props, false);
  }

  componentWillReceiveProps(nextProps: ImageFrameWithLoadingProps) {
    if (nextProps.imageSpec !== this.props.imageSpec) { // Assumes imageSpec to be immutable
      this.handleImageChange(nextProps);
    }
  }

  componentWillUnmount() {
    // Don't handle any returning downloads anymore after unmount.
    this.requestId = -1;
  }

  render() {
    return (
      <StretchingDiv>
      {this.state.image != null ?
        <ImageFrame
          exposure={this.props.exposure}
          gamma={this.props.gamma}
          offset={this.props.offset}
          image={this.state.image}
          ref={(frame) => this.imageFrame = frame}
          allowMovement={this.props.allowMovement}
          enableMouseEvents={this.props.enableMouseEvents}
        />
        : null}
        {this.state.isLoading ? <LoadingOverlay>Downloading ...</LoadingOverlay> : null}
        {this.state.errorMsg ? <LoadingOverlay>{this.state.errorMsg}</LoadingOverlay> : null}
      </StretchingDiv>
    );
  }

  /**
   * Initiate the download of the current spec.
   * Sets the state in case of correct or incorrect loads.
   */
  private handleImageChange(props: ImageFrameWithLoadingProps, shouldSetLoadingState: boolean = true) {
    this.currentRequest++;
    const handledRequest = this.currentRequest;

    if (shouldSetLoadingState) {
      this.setState({
        isLoading: true,
        errorMsg: null,
      });
    }

    this.downloadImage(props.imageSpec)
      .then(image => {
        if (handledRequest !== this.currentRequest) {
          // This download does not correspond to the latest request, so should not be shown.
          return;
        }
        this.setState({
          errorMsg: null,
          isLoading: false,
          image: image,
        });
      })
      .catch(error => {
        if (handledRequest !== this.requestId) {
          // This download does not correspond to the latest request, so should not be shown.
          return;
        }
        this.setState({
          errorMsg: error.message,
          isLoading: false,
        });
      });
  }

  /**
   * Download an image
   * @param image specification of the image to download (url or difference of two images)
   * @return Promise of a loaded image
   */
  private downloadImage(spec: ImageSpec): Promise<ImageInput> {
    if (spec.type === 'Url') {
      return this.cache.get(spec.url);
    } else if (spec.type === 'Difference') {
      return Promise.all([spec.urlA, spec.urlB].map(url => this.cache.get(url)))
        .then(([imageA, imageB]) => {
          // Make sure images have the same size and number of channels;
          const height = imageA.height;
          const width = imageA.width;
          const nChannels = imageA.nChannels;
          if (height !== imageB.height) {
            throw Error(`${spec.urlA} & ${spec.urlB} with heights ${height} & ${imageB.height} cannot be compared.`);
          }
          if (width !== imageB.width) {
            throw Error(`${spec.urlA} & ${spec.urlB} with widths ${width} & ${imageB.width} cannot be compared.`);
          }
          if (nChannels !== imageB.nChannels) {
            throw Error(`${spec.urlA} & ${spec.urlB} with unequal nChannels ${nChannels} & ${imageB.nChannels}.`);
          }
          return {
            type: spec.type,
            imageA,
            imageB,
            width,
            height,
            nChannels,
            lossFunction: spec.lossFunction,
          };
        });
    } else {
      throw Error(`Unkonwn imageSpec type for ${spec}.`);
    }
  }
}
