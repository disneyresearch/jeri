import * as React from 'react';
import styled from 'styled-components';
import { Matrix4x4 } from '../../utils/linalg';

import numberAwareCompare from '../../utils/number-aware-compare';
import requestFullscreen from '../../utils/fullscreen';

import HelpScreen from './HelpScreen';
import ImageFrame from '../ImageFrame';
import { lossFunctionFromString } from '../../layers/Layer';
import ImageFrameWithLoading, { ImageSpec } from '../ImageFrameWithLoading';
import { NavRow } from './navigation';

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
  helpIsOpen: boolean;           /** Whether the help screen overlay is currently open */
  defaultTransformation: Matrix4x4;
  transformationNeedsUpdate: boolean;
  hasFocus: boolean; /** The viewer has 'focus', i.e. the user clicked on it */
}

export interface ImageViewerProps {
  data: InputTree;             /** Unsorted input tree, use the sorted this.menuData instead */
  baseUrl: string;             /** Prefix for all images */
  sortMenu: boolean;           /** Whether to sort the menu-items automatically */
  removeCommonPrefix: boolean; /** Should common prefices of menu names be shortened. */
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

export default class ImageViewer extends React.Component<ImageViewerProps, ImageViewerState> {

  static defaultProps = {
    baseUrl: '',
    sortMenu: false,
    removeCommonPrefix: false,
  };

  /** A sorted version of props.data, cached for efficiency and recomputed when props change */
  private menuData: InputTree;
  /** A reference the the imageFrame element, ready once the ImageViewer is loaded */
  private imageFrame: ImageFrame | null;
  /** A reference to the div element of the containing div */
  private mainContainer: HTMLDivElement;

  constructor(props: ImageViewerProps) {
    super(props);
    this.menuData = this.props.data;
    if (props.sortMenu) {
      this.menuData = this.sortMenuRows(this.menuData);
    }
    // Set the initial state
    this.state = {
      activeRow: 0,
      selection: this.getDefaultSelection(this.menuData).slice(1),
      viewTransform: { default: 0.0 },
      exposure: { default: 1.0 },
      helpIsOpen: false,
      defaultTransformation: Matrix4x4.create(),
      transformationNeedsUpdate: true,
      hasFocus: false,
    };
    // Make sure 'this' is available in the keyboard handler when assigned to the keyup event
    this.keyboardHandler = this.keyboardHandler.bind(this);
    this.setFocus = this.setFocus.bind(this);
    this.unsetFocus = this.unsetFocus.bind(this);
  }

  componentDidMount() {
    this.mainContainer.setAttribute('tabindex', '1');
    this.mainContainer.addEventListener('keydown', this.keyboardHandler);
    this.mainContainer.addEventListener('focus', this.setFocus);
    this.mainContainer.addEventListener('focusout', this.unsetFocus);
  }

  componentDidUpdate() {
    if (this.imageFrame && this.state.transformationNeedsUpdate) {
      this.imageFrame.setTransformation(this.state.defaultTransformation);
      this.setState({ transformationNeedsUpdate: false });
    }
  }

  componentWillReceiveProps(nextProps: ImageViewerProps) {
    this.menuData = nextProps.data;
    if (this.props.sortMenu) {
      this.menuData = this.sortMenuRows(this.menuData);
    }
    this.validateSelection(this.state.selection, this.state.activeRow);
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
    const rows = this.activeRows(this.menuData, this.state.selection);
    const imageSpec = this.imageSpec();
    return (
      <MainDiv innerRef={(div: HTMLDivElement) => this.mainContainer = div}>
        <div>
        {rows.map((row, i)  => (
          <NavRow
            key={row.title}
            row={row}
            selection={this.state.selection[i]}
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
            gamma={1.0}
            offset={0.0}
            imageSpec={imageSpec}
            ref={(frame) => this.imageFrame = (frame != null) ? frame.imageFrame : null}
            allowMovement={true}
            enableMouseEvents={this.state.hasFocus}
          />
          {this.state.helpIsOpen ? <HelpScreen /> : null}
        </ImageArea>
      </MainDiv>
    );
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
        throw new Error(`Failed to find a match for ${selection}`);
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
  private currentImage(currentSelection: string[] = this.state.selection): InputLeaf {
    let selection = [...currentSelection];
    let tree: InputNode = this.menuData as InputNode;
    while (selection.length > 0) {
      let entry = selection.shift();
      tree = tree.children.find(item => item.title === entry) as InputNode;
    }
    return tree as any; // tslint:disable-line
  }

  /**
   * Specification for the current image to load
   */
  private imageSpec(currentSelection: string[] = this.state.selection): ImageSpec {
    const img = this.currentImage(currentSelection);
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
   * if they exist. Otherwise, we resort to the default selection (first elements).
   */
  private navigateTo(rows: InputNode[], rowIndex: number, title: string) {
    let selection = [...this.state.selection];
    selection[rowIndex] = title;
    let activeRow = this.state.activeRow;
    if (SHIFT_IS_DOWN) {
      // Set active row on shift click
      activeRow = rowIndex;
    }
    this.validateSelection(selection, activeRow);
  }

  /**
   * Make sure that the current selection is valid given the current menuData
   *
   * If a title in the selection does not exist in the respective row, take the default
   * (first) element of the row.
   * @param wishes the desired selection, which might not be valid given the selected menu items
   */
  private validateSelection(wishes: string[], activeRow: number) {
    let selection = [];
    let i = 0;
    let root = this.menuData as InputNode;
    while (root.hasOwnProperty('children')) {
      let candidate = root.children.find(row => row.title === wishes[i]);
      if (candidate) {
        root = candidate as InputNode;
        selection.push(candidate.title);
      } else {
        root = root.children[0] as InputNode; // resort to the first
        selection.push(root.title);
      }
      i++;
    }
    this.setState({
      selection: selection,
      activeRow: Math.min(activeRow, selection.length - 1),
    });
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
      const rows = this.activeRows(this.menuData, this.state.selection);
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
      const rows = this.activeRows(this.menuData, this.state.selection);
      const activeRow = this.state.activeRow;
      const currentTitle = this.state.selection[activeRow];
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
      let nextRow = this.state.activeRow + offset;
      if (nextRow < 0) {
        nextRow = 0;
      }
      if (nextRow >= this.state.selection.length - 1) {
        nextRow = this.state.selection.length - 1;
      }
      this.setState({ activeRow: nextRow });
    };
    actionsUnderShift.ArrowUp = moveUpDown(-1);
    actionsUnderShift.ArrowDown = moveUpDown(1);
    actions['['] = moveUpDown(-1);
    actions[']'] = moveUpDown(1);

    // ViewTransform controls
    const changeViewTransform = () => () => {
      const tonemapGroup = this.imageSpec().tonemapGroup;
      const viewTransform = {
        ...this.state.viewTransform,
        [tonemapGroup]: (Math.abs(this.state.viewTransform[tonemapGroup] - 1))
      };
      this.setState({ viewTransform });
    };
    actions.t = changeViewTransform();

    // Exposure controls
    const changeExposure = (multiplier: number) => () => {
      const tonemapGroup = this.imageSpec().tonemapGroup;
      const exposure = {
        ...this.state.exposure,
        [tonemapGroup]: multiplier * (this.state.exposure[tonemapGroup] || 1.0)
      };
      this.setState({ exposure });
    };
    actions.e = changeExposure(1.1);
    actions.E = changeExposure(1.0 / 1.1);

    // Reset
    actions.r = () => {
      this.setState({ viewTransform: { default: 0.0 } });
      this.setState({ exposure: { default: 1.0 } });
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
