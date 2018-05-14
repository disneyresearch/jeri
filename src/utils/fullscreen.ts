export default function requestFullscreen(element: any) { //tslint:disable-line
    if (element.requestFullscreen) {
        element.requestFullscreen();
    } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
    } else if (element.webkitRequestFullScreen) {
        element.webkitRequestFullScreen((Element as any).ALLOW_KEYBOARD_INPUT); //tslint:disable-line
    }
}
