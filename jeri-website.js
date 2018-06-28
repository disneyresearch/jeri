// Acivate JERI for all DOM elements with a class 'jeri-view'
for (let elem of document.getElementsByClassName('jeri-view')) {
    const data = JSON.parse(elem.dataset.data);
    Jeri.renderViewer(elem, data);
}

// Enable toggling in code examples
function CodeExample(domElem) {
    this.openTab = 'code';
    this.codeBtn = domElem.getElementsByClassName('code-example-link-code')[0];
    this.viewerBtn = domElem.getElementsByClassName('code-example-link-result')[0];
    this.codeView = domElem.getElementsByClassName('code-example-code')[0];
    this.viewerView = domElem.getElementsByClassName('code-example-viewer')[0];
    this.codeBtn.addEventListener('click', this.changeTab.bind(this, 'code'));
    this.viewerBtn.addEventListener('click', this.changeTab.bind(this, 'viewer'));
    this.render();
}
CodeExample.prototype.changeTab = function (toTab) {
    if (toTab !== this.openTab) {
        this.openTab = toTab;
        this.render();
    }
};
CodeExample.prototype.render = function () {
    if (this.openTab === 'code') {
        this.codeBtn.classList.add('active');
        this.viewerBtn.classList.remove('active');
        this.codeView.style.display = 'block';
        this.viewerView.style.display = 'none';
    } else if (this.openTab === 'viewer') {
        this.codeBtn.classList.remove('active');
        this.viewerBtn.classList.add('active');
        this.codeView.style.display = 'none';
        this.viewerView.style.display = 'block';
    } else {
        throw new Error('Illegal state for code example');
    }
};

for (let elem of document.getElementsByClassName('code-example-js')) {
    const codeEx = new CodeExample(elem);
    codeEx.render();
}
