export class UndoManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];

        this.isApplying = false;
        this.isUndoing = false;
        this.isRedoing = false;
    }

    push(state) {
        if (this.isApplying || this.isUndoing || this.isRedoing) {
            return;
        }

        this.undoStack.push(state);

        this.redoStack.length = 0;

    }

    undo(applyFn) {
        if (this.undoStack.length <= 1) {
            return false;
        }

        this.isUndoing = true;
        this.isApplying = true;

        const state = this.undoStack.pop();
        this.redoStack.push(state);

        const prev = this.undoStack[this.undoStack.length - 1];

        applyFn(prev);

        this.isUndoing = false;
        this.isApplying = false;

        return true;
    }

    redo(applyFn) {
        if (this.redoStack.length === 0) {
            return false;
        }
        
        this.isRedoing = true;
        this.isApplying = true;

        const state = this.redoStack.pop();
        this.undoStack.push(state);

        applyFn(state);

        this.isRedoing = false;
        this.isApplying = false;

        return true;
    }
}