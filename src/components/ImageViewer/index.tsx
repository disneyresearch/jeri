import * as React from 'react';
import memoizeOne from "memoize-one";
import { isEqual } from 'lodash';
import styled from 'styled-components';
import { Matrix4x4 } from '../../utils/linalg';

import numberAwareCompare from '../../utils/number-aware-compare';
import requestFullscreen from '../../utils/fullscreen';

import HelpScreen from './HelpScreen';
import ImageFrame from '../ImageFrame';
import { lossFunctionFromString, LossFunction } from '../../layers/Layer';
import { ViewTransform } from '../../layers/ImageLayer';
import ImageFrameWithLoading, { ImageSpec, ImageSpecUrl, ImageSpecLossMap } from '../ImageFrameWithLoading';
import { NavRow } from './navigation';

import * as levenshtein from 'fast-levenshtein';

const MainDiv = styled.div`
  background-color: #333;
  font-size: .9em;
  position: absolute;
  top: 0; bottom: 0; left: 0; right: 0;
  display: flex;
  flex-direction: column;
  color: #AAA;
`;

const ImageArea = styled.div`
  flex-grow: 1;
  position: relative;
`;

const ImageInfo = styled.div`
  background-color: #333;
  color: #AAA;
  padding: 0;
  font-size: x-small;
`;

const ImageInfoBlock = styled.span`
  display: inline-block;
  margin: 0px 1px;
  padding: .4em .6em;
  text-decoration: none;
  color: #AAA;
`;

const ImageInfoLink = styled.a`
  display: inline-block
  background-color: #666;
  color: #AAA;
  margin: 0px 1px;
  padding: .4em .6em;
  text-decoration: none;
  user-select: none;
  -moz-user-select: none;
`;

export type InputTree = InputNode | InputLeaf;

export interface InputNode {
  title: string;
  children: InputTree[];
}

export type InputLeaf = InputLeafImage | InputLeafLossMap;

export interface InputLeafImage {
  title: string;
  image: string;
}
export interface InputLeafLossMap {
  title: string;
  lossMap: {
    function: string;
    imageA: string;
    imageB: string;
  };
}

export interface ImageViewerState {
  activeRow: number;             /** The number of the row that is currently active for keyboard toggling */
  selection: string[];           /** List of item titles that are selected */
  viewTransform: {[tonemapGroup: string]: number}; /** Image view transform, a number between 0 and 1 for each tonemapGroup (string) */
  exposure: {[tonemapGroup: string]: number}; /** Image exposure, a number > 0 for each tonemapGroup (string) */
  gamma: {[tonemapGroup: string]: number}; /** Image gamma, a number > 0 for each tonemapGroup (string) */
  helpIsOpen: boolean;           /** Whether the help screen overlay is currently open */
  defaultTransformation: Matrix4x4;
  transformationNeedsUpdate: boolean;
  hasFocus: boolean; /** The viewer has 'focus', i.e. the user clicked on it */
}

export interface ImageViewerProps {
  data: InputTree;             /** Unsorted input tree, use the accessor this.getMenu() instead */
  baseUrl: string;             /** Prefix for all images */
  sortMenu: boolean;           /** Whether to sort the menu-items automatically */
  removeCommonPrefix: boolean; /** Should common prefices of menu names be shortened. */
  showInfo: boolean;           /** Should the info footer be shown */
  selection?: string[];         /** List of item titles that are selected */
  onSelectionChange?: (selection: string[]) => void; /** The selection changed callback */
}


// A little hack to allow detecting shift click
let SHIFT_IS_DOWN: boolean = false;
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Shift') {
    SHIFT_IS_DOWN = true;
  }
});
document.addEventListener('keyup', (ev) => {
  if (ev.key === 'Shift') {
    SHIFT_IS_DOWN = false;
  }
});

// A replacement editing distance
function distance(a: string, b:string) {
    let distance = levenshtein.get(a, b);
    return distance;
}

export default class ImageViewer extends React.Component<ImageViewerProps, ImageViewerState> {

  static defaultProps = {
    baseUrl: '',
    sortMenu: false,
    removeCommonPrefix: false,
    showInfo: true,
  };

  /** A reference the the imageFrame element, ready once the ImageViewer is loaded */
  private imageFrame: ImageFrame | null;
  /** A reference to the div element of the containing div */
  private mainContainer: HTMLDivElement;

  constructor(props: ImageViewerProps) {
    super(props);
    // Controlled or stand-alone component
    if (Boolean(this.props.selection) != Boolean(this.props.onSelectionChange)) {
      throw new Error("ImageViewer properties selection and onSelectionChange must both be set or both be unset.")
    }
    // Set the initial state
    this.state = {
      activeRow: 0,
      selection: this.getDefaultSelection(this.getMenu()).slice(1),
      viewTransform: { default: 1 },
      exposure: { default: 1.0 },
      gamma: { default: 1.0 },
      helpIsOpen: false,
      defaultTransformation: Matrix4x4.create(),
      transformationNeedsUpdate: true,
      hasFocus: false,
    };
    // Make sure 'this' is available in the keyboard handler when assigned to the keyup event
    this.keyboardHandler = this.keyboardHandler.bind(this);
    this.setFocus = this.setFocus.bind(this);
    this.unsetFocus = this.unsetFocus.bind(this);
    // Cache filter results
    this.validateSelection = memoizeOne(this.validateSelection, isEqual);
    this.sortMenuRows = memoizeOne(this.sortMenuRows, isEqual);
  }

  getSelection() {
    let selection = this.props.selection ? this.props.selection : this.state.selection;
    return this.validateSelection(selection, this.getMenu() as InputNode);
  }

  getMenu() {
    if (this.props.sortMenu) {
      return this.sortMenuRows(this.props.data);
    }
    return this.props.data;
  }

  componentDidMount() {
    if (this.props.onSelectionChange) {
      this.props.onSelectionChange(this.getSelection());
    }
    this.mainContainer.setAttribute('tabindex', '1');
    this.mainContainer.addEventListener('keydown', this.keyboardHandler);
    this.mainContainer.addEventListener('focus', this.setFocus);
    this.mainContainer.addEventListener('focusout', this.unsetFocus);
  }

  componentDidUpdate(prevProps: ImageViewerProps) {
    if (this.imageFrame && this.state.transformationNeedsUpdate) {
      this.imageFrame.setTransformation(this.state.defaultTransformation);
      this.setState({ transformationNeedsUpdate: false });
    }
    // Controlled or stand-alone component
    if (Boolean(this.props.selection) != Boolean(this.props.onSelectionChange)) {
      throw new Error("ImageViewer properties selection and onSelectionChange must both be set or both be unset.")
    }
    if (this.props.selection) {
      // If this component is controlled, notify controller of valid selection, if the props changed
      if (!isEqual(this.props.selection, prevProps.selection)) {
        const selection = this.getSelection();
        if (!isEqual(selection, this.props.selection)) {
          this.updateSelectionState(selection);
        }
      }
    }
    else {
      // If component is not controlled, then there's nothing to do
    }
  }

  componentWillUnmount() {
    this.mainContainer.removeEventListener('keydown', this.keyboardHandler);
  }

  setTransformation(transformation: Matrix4x4) {
    if (this.imageFrame != null) {
      this.imageFrame.setTransformation(transformation);
    }
    this.setState({ defaultTransformation: transformation });
  }

  render() {
    const menuData = this.getMenu();
    const selection = this.getSelection();
    const rows = this.activeRows(menuData, selection);
    const imageSpec = this.imageSpec(selection, menuData);
    return (
      <MainDiv ref={(div: HTMLDivElement) => this.mainContainer = div}>
        <div>
        {rows.map((row, i)  => (
          <NavRow
            key={row.title}
            row={row}
            selection={selection[i]}
            handleClick={this.navigateTo.bind(this, rows, i)}
            removeCommonPrefix={this.props.removeCommonPrefix}
            active={this.state.activeRow === i}
          />
        ))}
        </div>
        <ImageArea>
          <ImageFrameWithLoading
            viewTransform={this.state.viewTransform[imageSpec.tonemapGroup]}
            exposure={this.state.exposure[imageSpec.tonemapGroup] || 1.0}
            gamma={this.state.gamma[imageSpec.tonemapGroup] || 1.0}
            offset={0.0}
            imageSpec={imageSpec}
            ref={(frame) => this.imageFrame = (frame != null) ? frame.imageFrame : null}
            allowMovement={true}
            enableMouseEvents={this.state.hasFocus}
          />
          {this.state.helpIsOpen ? <HelpScreen /> : null}
        </ImageArea>
        {this.renderImageSpec(imageSpec)}
      </MainDiv>
    );
  }

  private renderImageSpec(imageSpec: ImageSpec) {
    if (!this.props.showInfo) {
      return <></>;
    }
    if (imageSpec.type === 'Difference') {
      imageSpec = imageSpec as ImageSpecLossMap;
      return (
        <ImageInfo>
          <ImageInfoLink href={imageSpec.urlA}>{imageSpec.urlA.split('/').pop()}</ImageInfoLink>
          <ImageInfoLink href={imageSpec.urlB}>{imageSpec.urlB.split('/').pop()}</ImageInfoLink>
          <ImageInfoBlock>Loss: {LossFunction[imageSpec.lossFunction]}</ImageInfoBlock>
          <ImageInfoBlock>Exposure: {(this.state.exposure[imageSpec.tonemapGroup] || 1.0).toPrecision(3)}</ImageInfoBlock>
          <ImageInfoBlock>Gamma: {(this.state.gamma[imageSpec.tonemapGroup] || 1.0).toPrecision(3)}</ImageInfoBlock>
        </ImageInfo>
      );
    } else if (imageSpec.type === 'Url') {
      imageSpec = imageSpec as ImageSpecUrl;
      return (
        <ImageInfo>
          <ImageInfoLink href={imageSpec.url}>{imageSpec.url.split('/').pop()}</ImageInfoLink>
          <ImageInfoBlock>Transform: {ViewTransform[this.state.viewTransform[imageSpec.tonemapGroup]]}</ImageInfoBlock>
          <ImageInfoBlock>Exposure: {(this.state.exposure[imageSpec.tonemapGroup] || 1.0).toPrecision(3)}</ImageInfoBlock>
          <ImageInfoBlock>Gamma: {(this.state.gamma[imageSpec.tonemapGroup] || 1.0).toPrecision(3)}</ImageInfoBlock>
        </ImageInfo>
      );
    } else {
      return <></>;
    }
  }

  /**
   * Select the active rows from the navigation data tree, according to the given selection
   *
   * @param tree navigation datastructure
   * @param selection array of the titles of selected items from top to bottom
   */
  private activeRows(tree: InputTree, selection: string[]): InputNode[] {
    if (selection.length === 0) {
      // Base case of the recursion
      return [];
    } else {
      // Find the child with this name
      if (!tree.hasOwnProperty('children')) {
        throw new Error(`Can't find match for ${selection}`);
      }
      const node = (tree as InputNode);
      const res = node.children.find(child => child.title === selection[0]);
      if (res == null) {
        // fall back to giving up
        return [];
      } else {
        return [node].concat(this.activeRows(res, selection.slice(1)));
      }
    }
  }

  /**
   * Recursively sort the input data
   *
   * It's a bit smart, for example bathroom-32 will come before bathroom-128,
   * and the word Color always goes first.
   * @param tree to be sored
   */
  private sortMenuRows(tree: InputTree): InputTree {
    if (tree.hasOwnProperty('children')) {
      const node = tree as InputNode;
      const children = node.children.map(child => this.sortMenuRows(child));
      children.sort((a, b) => {
        if (a.title === b.title) {
          return 0;
        } else if (a.title === 'Color') {
          return -1;
        } else if (b.title === 'Color') {
          return 1;
        } else {
          return numberAwareCompare(a.title, b.title);
        }
      });
      return {
        title: node.title,
        children: children,
      };
    } else {
      return tree;
    }
  }

  /**
   * Find the image to be shown based on the current selection
   */
  private currentImage(currentSelection: string[], menuData: InputTree): InputLeaf {
    let selection = [...currentSelection];
    let tree: InputNode = menuData as InputNode;
    while (selection.length > 0) {
      let entry = selection.shift();
      tree = tree.children.find(item => item.title === entry) as InputNode;
    }
    return tree as any; // tslint:disable-line
  }

  /**
   * Specification for the current image to load
   */
  private imageSpec(currentSelection: string[], menuData: InputTree): ImageSpec {
    const img = this.currentImage(currentSelection, menuData);
    if (img.hasOwnProperty('lossMap')) {
      const config = img as InputLeafLossMap;
      return {
        type: 'Difference',
        lossFunction: lossFunctionFromString(config.lossMap.function),
        urlA: this.props.baseUrl + config.lossMap.imageA,
        urlB: this.props.baseUrl + config.lossMap.imageB,
        tonemapGroup: (config as any).tonemapGroup || 'default', // tslint:disable-line
      };
    } else {
      return {
        type: 'Url',
        url: this.props.baseUrl + (img as InputLeafImage).image,
        tonemapGroup: (img as any).tonemapGroup || 'default', // tslint:disable-line
      };
    }
  }

  /**
   * Navigate to a particular image
   *
   * @param rows: a list of the rows currently visible
   * @param rowIndex: the index of the row in which to switch tabs
   * @param title: the title of the requested node
   *
   * For rows > rowIndex, we select children matching the current selection titles
   * if they exist. Otherwise, we resort to lazy matching.
   */
  private navigateTo(rows: InputNode[], rowIndex: number, title: string) {
    let selection = [...this.getSelection()];
    selection[rowIndex] = title;
    let activeRow = this.state.activeRow;
    if (SHIFT_IS_DOWN) {
      // Set active row on shift click
      activeRow = rowIndex;
    }
    if (this.state.activeRow !== activeRow) {
      this.setState({ activeRow: Math.min(activeRow, selection.length - 1) });
    }
    this.updateSelectionState(selection);
  }

  /**
   * Make sure that the current selection is valid given the current menu data
   *
   * If a title in the selection does not exist in the respective row, take a closely matching
   * element of the row.
   * @param wishes the desired selection, which might not be valid given the selected menu items
   */
  private validateSelection(wishes: string[], root: InputNode) : string[] {
    let selection = [];
    let i = 0;
    while (root.hasOwnProperty('children')) {
      let candidate = root.children.find(row => row.title === wishes[i]);
      if (candidate) {
        root = candidate as InputNode;
      } else if (i < wishes.length && wishes[i]) {
        const lastSelection = wishes[i];
        const closest = root.children
          .map((row) => distance(row.title, lastSelection))
          .reduce((res, val, idx) => val < res.val ? {val:val, idx:idx} : res, {val:Number.MAX_SAFE_INTEGER,idx:0});
        root = root.children[closest.idx] as InputNode;
      } else {
        root = root.children[0] as InputNode; // resort to the first
      }
      selection.push(root.title);
      i++;
    }
    return selection;
  }

  /**
   * Update the selection state in the internal state or observers, depending
   * on configuration.
   * @param selection The selection to use
   */
  private updateSelectionState(selection: string[]) {
    if (this.props.selection) {
      // Controlled
      if (!isEqual(selection, this.props.selection)) {
        if (this.props.onSelectionChange) {
          this.props.onSelectionChange(selection);
        }
      }
    }
    else {
      // Stand-alone
      if (!isEqual(selection, this.state.selection)) {
        this.setState({ selection: selection });
      }
    }
  }

  /**
   * Return the titles of the first items of a sorted tree
   * @param tree a sorted navigation data structure
   */
  private getDefaultSelection(tree: InputTree): string[] {
    if (tree.hasOwnProperty('children')) {
      const node = tree as InputNode;
      if (node.children.length > 0) {
        return [node.title].concat(this.getDefaultSelection(node.children[0]));
      } else {
        return [node.title];
      }
    } else {
      return [tree.title];
    }
  }

  private dumpTransformation(): void {
    if (this.imageFrame != null) {
      const transformation = this.imageFrame.getTransformation();
      console.log(transformation.data);
    }
  }

  private keyboardHandler(event: KeyboardEvent) {
    const { key } = event;

    const actions: {[x: string]: Function} = {};
    const actionsUnderShift: {[x: string]: Function} = {};

    // Number keys
    const goToNumber = (i: number) => () => {
      const rows = this.activeRows(this.getMenu(), this.getSelection());
      const activeRow = this.state.activeRow;
      const goTo = rows[activeRow].children[i];
      if (goTo != null) {
        this.navigateTo(rows, activeRow, goTo.title);
      }
    };
    actions['0'] = goToNumber(9);
    for (let i = 1; i <= 9; ++i) {
      actions[i.toString()] = goToNumber(i - 1);
    }

    // Arrows
    const moveInLine = (offset: number) => () => {
      const selection = this.getSelection();
      const rows = this.activeRows(this.getMenu(), selection);
      const activeRow = this.state.activeRow;
      const currentTitle = selection[activeRow];
      const currentIndex = rows[activeRow].children.findIndex(n => n.title === currentTitle);
      const nextIndex = (currentIndex + offset + rows[activeRow].children.length) % rows[activeRow].children.length;
      const goTo = rows[activeRow].children[nextIndex];
      this.navigateTo(rows, activeRow, goTo.title);
    };
    actionsUnderShift.ArrowLeft = moveInLine(-1);
    actionsUnderShift.ArrowRight = moveInLine(1);
    actions['-'] = moveInLine(-1);
    actions['='] = moveInLine(1);
    const moveUpDown = (offset: number) => () => {
      const selection = this.getSelection();
      let nextRow = this.state.activeRow + offset;
      if (nextRow < 0) {
        nextRow = 0;
      }
      if (nextRow >= selection.length - 1) {
        nextRow = selection.length - 1;
      }
      this.setState({ activeRow: nextRow });
    };
    actionsUnderShift.ArrowUp = moveUpDown(-1);
    actionsUnderShift.ArrowDown = moveUpDown(1);
    actions['['] = moveUpDown(-1);
    actions[']'] = moveUpDown(1);

    // ViewTransform controls
    const changeViewTransform = () => () => {
      const selection = this.getSelection();
      const tonemapGroup = this.imageSpec(selection, this.getMenu()).tonemapGroup;
      const viewTransform = {
        ...this.state.viewTransform,
        [tonemapGroup]: (this.state.viewTransform[tonemapGroup] + 1) % ViewTransform.Size
      };
      this.setState({ viewTransform });
    };
    actions.t = changeViewTransform();

    // Exposure controls
    const changeExposure = (multiplier: number) => () => {
      const selection = this.getSelection();
      const tonemapGroup = this.imageSpec(selection, this.getMenu()).tonemapGroup;
      const exposure = {
        ...this.state.exposure,
        [tonemapGroup]: multiplier * (this.state.exposure[tonemapGroup] || 1.0)
      };
      this.setState({ exposure });
    };
    actions.e = changeExposure(1.1);
    actions.E = changeExposure(1.0 / 1.1);

    // Gamma Controlls
    const changeGamma = (multiplier: number) => () => {
      const selection = this.getSelection();
      const tonemapGroup = this.imageSpec(selection, this.getMenu()).tonemapGroup;
      const gamma = {
        ...this.state.gamma,
        [tonemapGroup]: multiplier * (this.state.gamma[tonemapGroup] || 1.0)
      };
      this.setState({ gamma });
    };
    actions.g = changeGamma(1.1);
    actions.G = changeGamma(1.0 / 1.1);

    // Reset
    actions.r = () => {
      this.setState({ viewTransform: { default: 1 } });
      this.setState({ exposure: { default: 1.0 } });
      this.setState({ gamma: { default: 1.0 } });
      if (this.imageFrame) {
        this.imageFrame.reset();
      }
    };

    // Toggle help
    actions['/'] = actions['?'] = () => {
      this.setState({ helpIsOpen: !this.state.helpIsOpen });
    };
    actions.Escape = () => {
      this.setState({ helpIsOpen: false });
    };

    // Go fullscreen
    actions.f = () => requestFullscreen(this.mainContainer);

    // Dump the current transformation
    actions.d = () => this.dumpTransformation();

    if (actions.hasOwnProperty(key) && !event.metaKey && !event.altKey && !event.ctrlKey) {
      event.preventDefault();
      actions[key]();
      return;
    }
    if (actionsUnderShift.hasOwnProperty(key) && event.shiftKey) {
      event.preventDefault();
      actionsUnderShift[key]();
      return;
    }
  }

  private setFocus() {
    this.setState({ hasFocus: true });
  }

  private unsetFocus() {
    this.setState({ hasFocus: false });
  }
}
