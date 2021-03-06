// ------------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All Rights Reserved.  Licensed under the MIT License.
// See License in the project root for license information.
// ------------------------------------------------------------------------------

import { AfterViewInit, Component, DoCheck, ViewChild, ViewContainerRef } from '@angular/core';
import { FormControl } from '@angular/forms';
import { initializeJsonViewer, initializeResponseHeadersViewer } from './api-explorer-jsviewer';
import { AppComponent } from './app.component';
import { GraphApiVersion, IExplorerValues, IMessageBarContent, Methods } from './base';
import { constructGraphLinksFromFullPath, getUrlsFromServiceURL, IGraphNodeLink } from './graph-structure';
import { GraphExplorerComponent } from './GraphExplorerComponent';
import { QueryRunnerService } from './query-runner.service';

declare let mwf: any;

@Component({
    selector: 'main-column',
    templateUrl: './main-column.component.html',
    styleUrls: ['./main-column.component.css'],
    providers: [QueryRunnerService],
})
export class MainColumnComponent extends GraphExplorerComponent implements AfterViewInit, DoCheck {
    public oldExplorerValues: IExplorerValues = {};
    public myControl = new FormControl();
    public methods = Methods;
    public GraphVersions = AppComponent.Options.GraphVersions;
    public showShareButton: boolean = false;

    @ViewChild('httpMethod', { read: ViewContainerRef }) public _httpMethodEl; // tslint:disable-line
    @ViewChild('graphVersion', { read: ViewContainerRef }) public _graphVersionEl; // tslint:disable-line
    @ViewChild('autoSuggest', { read: ViewContainerRef }) public _autoSuggestEl; // tslint:disable-line

    constructor(public queryRunnerService: QueryRunnerService) {
        super();
    }

    public messageBarContent(): IMessageBarContent {
        return AppComponent.messageBarContent;
    }

    public ngDoCheck() {
        if (this.explorerValues && JSON.stringify(this.oldExplorerValues) !== JSON.stringify(this.explorerValues)) {
            this.updateVersionFromEndpointUrl();
            this.updateGraphVersionSelect();

            this.updateHttpMethod();

            // Add content-type header when switching to POST
            if ((this.oldExplorerValues.selectedOption !== 'POST' && this.explorerValues.selectedOption === 'POST')
                || (this.oldExplorerValues.selectedOption !== 'PUT' && this.explorerValues.selectedOption === 'PUT')
                || (this.oldExplorerValues.selectedOption !== 'PATCH' && this.explorerValues.selectedOption === 'PATCH')
            ) {
                // If it doesn't already exist
                let hasContentTypeHeader = false;
                if (this.explorerValues.headers) {
                    for (const header of this.explorerValues.headers) {
                        if (header.name.toLowerCase() === 'content-type') {
                            hasContentTypeHeader = true;
                            break;
                        }
                    }
                    if (!hasContentTypeHeader) {
                        this.explorerValues.headers.unshift({
                            enabled: true,
                            name: 'Content-type',
                            readonly: false,
                            value: 'application/json',
                        });
                    }
                }
            }

            this.oldExplorerValues = JSON.parse(JSON.stringify(this.explorerValues));
        }
    }

    public ngAfterViewChecked() {
        /**
         * Disable the the httpVerb picker after the view has changed and the client is not authenticated. We are doing
         * like this since the httpVerb picker is a non-Angular, Microsoft Web Framework component that is loaded into
         * the DOM. It is not part of the Angular template and is loaded at ngAfterViewInit().
         */
        if (this.isAuthenticated()) {
            this._httpMethodEl.element.nativeElement.children[1].setAttribute('aria-disabled', 'false');
            this._httpMethodEl.element.nativeElement.children[1].children[0].removeAttribute('disabled');
        } else {
            this._httpMethodEl.element.nativeElement.children[1].setAttribute('aria-disabled', 'true');
            this._httpMethodEl.element.nativeElement.children[1].children[0].setAttribute('disabled', '');
        }
    }

    public ngAfterViewInit(): void {
        // Init httpMethod
        mwf.ComponentFactory.create([{
            component: mwf.Select,
            elements: [this._httpMethodEl.element.nativeElement],
            callback: (event: any) => {
                this.updateHttpMethod();
                event[0].selectMenu.subscribe({
                    onSelectionChanged: (method) => {
                        this.explorerValues.selectedOption = method.id;

                        if (this.explorerValues.selectedOption === 'GET') { this.showShareButton = true; }
                    },
                });
            },
        }]);

        // Init Graph version selector
        mwf.ComponentFactory.create([{
            component: mwf.Select,
            elements: [this._graphVersionEl.element.nativeElement],
            callback: (event: any) => {
                this.updateGraphVersionSelect();
                event[0].selectMenu.subscribe({
                    onSelectionChanged: (method) => {
                        this.explorerValues.selectedVersion = document
                            .getElementById('-' + method.id).children[0].textContent as GraphApiVersion;
                        this.updateEndpointURLVersionFromVersion();
                    },
                });
            },
        }]);

        initializeJsonViewer();
        initializeResponseHeadersViewer();

        mwf.ComponentFactory.create([{
            component: mwf.AutoSuggest,
            elements: [this._autoSuggestEl.element.nativeElement],
            callback: (autoSuggests) => {
                if (autoSuggests && (autoSuggests.length > 0)) {
                    const autoSuggest = autoSuggests[0];
                    if (!!autoSuggest) {
                        autoSuggest.subscribe({
                            onMatchPatternChanged: (notification) => {
                                autoSuggest.updateSuggestions(this.getAutoCompleteOptions()
                                    .map((s) => ({ type: 'string', value: s })));
                            },
                        });
                    }
                }
            },
        }]);
    }

    public endpointInputKeyDown(event) {
        if (event.keyCode === 13) {
            this.submit();
        }
    }

    public submit = () => {
        if (this.explorerValues.requestInProgress) {
            return;
        }
        this.queryRunnerService.executeExplorerQuery();
    }

    public getRelativeUrlFromGraphNodeLinks(links: IGraphNodeLink[]) {
        return links.map((x) => x.name).join('/');
    }

    public updateVersionFromEndpointUrl() {
        // If the user typed in a different version, change the dropdown
        const graphPathStartingWithVersion = this.explorerValues.endpointUrl.split(AppComponent.Options.GraphUrl + '/');
        if (graphPathStartingWithVersion.length < 2) {
            return;
        }
        const possibleGraphPathArr = graphPathStartingWithVersion[1].split('/');
        if (possibleGraphPathArr.length === 0) {
            return;
        }

        const possibleVersion = possibleGraphPathArr[0] as GraphApiVersion;

        /*
         If (AppComponent.Options.GraphVersions.indexOf(possibleVersion) !== -1) {
         possibleVersion is a valid version
        */
        this.explorerValues.selectedVersion = possibleVersion;

    }

    public getAutoCompleteOptions() {
        return this.getMatches(AppComponent.explorerValues.endpointUrl);
    }

    public getMatches(query: string): string[] {
        const urls = getUrlsFromServiceURL(AppComponent.explorerValues.selectedVersion);
        const currentGraphLinks = constructGraphLinksFromFullPath(query);

        if (!currentGraphLinks) {
            return [];
        }
        // If query ends with odata query param, don't return any URLs
        const lastNode = currentGraphLinks.pop();
        if (lastNode && lastNode.name.indexOf('?') !== -1) {
            return [];
        }

        return urls.filter((option) => option.indexOf(query) > -1);
    }

    public getShortUrl(url: string) {
        const serviceTextLength = AppComponent.explorerValues.endpointUrl.length;
        const useLastPathSegmentOnly = serviceTextLength !== undefined && serviceTextLength > 50;

        if (!useLastPathSegmentOnly) {
            return url;
        }
        const links = constructGraphLinksFromFullPath(url);
        return '/' + links[links.length - 1].name;
    }

    public updateGraphVersionSelect() {
        // Update version select from explorerValues
        const graphVersionSelectEl = this._graphVersionEl.element.nativeElement;

        if (!graphVersionSelectEl.mwfInstances) {
            return;
        }

        const graphVersionSelectMenu = graphVersionSelectEl.mwfInstances.t.selectMenu;

        let graphVersionIdx = this.GraphVersions.indexOf(this.explorerValues.selectedVersion);
        if (graphVersionIdx === -1) {
            document.getElementById('-Other').children[0].textContent = this.explorerValues.selectedVersion;
            graphVersionIdx = this.GraphVersions.indexOf('Other');

            // If we're selecting the other twice, the button text won't update automatically
            document.querySelector('.graph-version.c-select button').textContent = this.explorerValues.selectedVersion;
        }

        graphVersionSelectMenu.onItemSelected(graphVersionSelectMenu.items[graphVersionIdx]);

        this.updateEndpointURLVersionFromVersion();

    }

    public updateEndpointURLVersionFromVersion() {
        /* AppComponent.Options.GraphUrl may be https://graph.microsoft.com/
        or another sovereign cloud deployment endpoint*/
        const path = this.explorerValues.endpointUrl.split(AppComponent.Options.GraphUrl + '/');
        if (path.length > 1) {
            const pathStartingWithVersion = path[1].split('/');

            // Replace the version in the URL with the actual value
            pathStartingWithVersion[0] = AppComponent.explorerValues.selectedVersion;

            // Updates URL in input field
            this.explorerValues.endpointUrl = AppComponent.Options.GraphUrl + '/' + pathStartingWithVersion.join('/');
        }
    }

    public updateHttpMethod() {
        const httpMethodSelectMenuEl = this._httpMethodEl.element.nativeElement;

        if (!httpMethodSelectMenuEl.mwfInstances) {
            return;
        }

        const httpMethodSelectMenu = httpMethodSelectMenuEl.mwfInstances.t.selectMenu;

        const elementIdxToSelect = httpMethodSelectMenu.items[Methods.indexOf(this.explorerValues.selectedOption)];
        httpMethodSelectMenu.onItemSelected(elementIdxToSelect);
    }

}
