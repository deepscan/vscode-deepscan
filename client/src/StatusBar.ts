/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

import { CommandIds, Status } from './types';

export class StatusBar {
    statusBarItem: vscode.StatusBarItem;
    status: Status;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
        this.setStatus(Status.ok);
    
        this.statusBarItem.text = 'DeepScan';
        this.statusBarItem.command = CommandIds.showOutput;

        vscode.window.onDidChangeActiveColorTheme(() => {
            this.update(this.status);
        });
    }

    getStatusBarItem() {
        return this.statusBarItem;
    }

    getStatus() {
        return this.status;
    }

    setStatus(status: Status) {
        this.status = status;
    }

    getTooltip() {
        return this.statusBarItem.tooltip;
    }

    setTooltip(text: string) {
        this.statusBarItem.tooltip = text;
    }

    setColor(color: string) {
        this.statusBarItem.color = color;
    }

    show(show: boolean): void {
        show ? this.statusBarItem.show() : this.statusBarItem.hide();
    }

    update(status: Status) {
        let tooltip = this.getTooltip() as string;
        let color = '';
        const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
        switch (status) {
            case Status.ok:
                color = isDarkTheme? 'lightgreen' : 'darkgreen';
                tooltip = 'Issue-free!';
                break;
            case Status.warn:
                color = isDarkTheme? 'yellow' : '#BA8E23';
                tooltip = 'Issue(s) detected!';
                break;
            case Status.fail:
            case Status.EMPTY_TOKEN:
            case Status.EXPIRED_TOKEN:
            case Status.INVALID_TOKEN:
            case Status.SUSPENDED_TOKEN:
                color = 'darkred';
                tooltip = 'Inspection failed!';
                break;
        }
        this.setColor(color);
        this.setTooltip(tooltip);
        this.setStatus(status);
    }
}
