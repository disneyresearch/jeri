import * as React from 'react';
import * as ReactDOM from 'react-dom';
import ImageFrame from './components/ImageFrame';
import ImageViewer, { InputTree } from './components/ImageViewer';
import ImageLayer from './layers/ImageLayer';
import TextLayer from './layers/TextLayer';
import MouseLayer from './layers/MouseLayer';
import { loadImage, ImageCache } from './utils/image-loading';
import { Matrix4x4, Vector4 } from './utils/linalg';

export {
    loadImage,
    ImageCache,
    ImageFrame,
    ImageLayer,
    ImageViewer,
    TextLayer,
    MouseLayer,
    Matrix4x4,
    Vector4
};

export function renderViewer(
        elem: HTMLElement,
        data: InputTree,
        baseUrl: string = ''
) {
    const component = (
        <ImageViewer
            data={data}
            baseUrl={baseUrl}
            sortMenu={false}
            removeCommonPrefix={false}
        />
    );
    return ReactDOM.render(component, elem);
}

export default ImageViewer;
