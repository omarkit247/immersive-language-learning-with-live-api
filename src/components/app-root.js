/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import './view-splash.js';
import './view-missions.js';
import './view-chat.js';
import './view-summary.js';
import './view-tutor.js';
import './text-cycler.js';

class AppRoot extends HTMLElement {
    constructor() {
        super();
        this.state = {
            view: 'splash', // splash, missions, chat, summary
            selectedMission: null,
            selectedLanguage: null,
            sessionResult: null
        };
    }

    connectedCallback() {
        // Setup static layout once
        this.innerHTML = '';

        // Theme State
        this.themes = ['dark', 'light', 'system'];
        this.currentTheme = localStorage.getItem('theme') || 'system';

        // System Theme Listener
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.mediaQuery.addEventListener('change', () => {
            if (this.currentTheme === 'system') {
                this.applyTheme('system');
            }
        });

        // Initial Theme Application
        this.applyTheme(this.currentTheme);

        // Persistent Header container
        const header = document.createElement('header');
        header.style.cssText = `
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding: var(--spacing-sm) var(--spacing-md);
            gap: var(--spacing-md);
            width: 100%;
            pointer-events: none; /* Let clicks pass through to underlying elements if needed, but buttons need pointer-events: auto */
        `;

        header.innerHTML = `
            <div style="pointer-events: auto; display: flex; align-items: center; gap: var(--spacing-sm);">
                <a href="https://github.com/ZackAkil/immersive-language-learning-with-live-api" target="_blank" style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    padding: 14px 28px;
                    border: 2px dashed var(--color-accent-primary);
                    border-radius: var(--radius-md);
                    color: var(--color-text-main);
                    text-decoration: none;
                    font-weight: 800;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    background: var(--color-surface);
                    font-size: 1.1rem;
                    backdrop-filter: blur(10px);
                    box-shadow: var(--shadow-sm);
                " onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='var(--shadow-md)'; this.style.background='var(--color-bg)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='var(--shadow-sm)'; this.style.background='var(--color-surface)';" >
                    <svg height="20" viewBox="0 0 16 16" version="1.1" width="20" aria-hidden="true" style="fill: currentColor; opacity: 0.8;"><path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
                    Source
                </a>
            </div>

            <button id="theme-toggle" aria-label="Toggle Theme" style="
                pointer-events: auto;
                background: var(--color-surface);
                color: var(--color-text-main);
                border: 1px solid var(--glass-border);
                border-radius: 50%;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: var(--shadow-sm);
                font-size: 1.2rem;
                transition: all 0.2s ease;
                backdrop-filter: blur(10px);
            ">
                <span class="theme-icon"></span>
            </button>
        `;

        this.appendChild(header);

        // Theme Toggle Logic
        const themeBtn = header.querySelector('#theme-toggle');
        themeBtn.onclick = () => this.cycleTheme();
        this.themeBtn = themeBtn;
        this.updateThemeBtnIcon();

        // Inject GitHub Buttons Script
        if (!document.getElementById('github-buttons-script')) {
            const script = document.createElement('script');
            script.id = 'github-buttons-script';
            script.src = 'https://buttons.github.io/buttons.js';
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }

        // View Container
        this.viewContainer = document.createElement('div');
        this.viewContainer.style.height = "100%";
        this.viewContainer.style.width = "100%";
        this.appendChild(this.viewContainer);

        this.render();

        this.checkConfigStatus();

        this.addEventListener('navigate', (e) => {
            this.state.view = this.privateTutor && ['missions', 'mission-selector'].includes(e.detail.view) ? 'tutor' : e.detail.view;
            if (e.detail.mission) this.state.selectedMission = e.detail.mission;
            if (e.detail.language) this.state.selectedLanguage = e.detail.language;
            if (e.detail.fromLanguage) this.state.selectedFromLanguage = e.detail.fromLanguage;
            if (e.detail.mode) this.state.selectedMode = e.detail.mode;
            if (e.detail.result) this.state.sessionResult = e.detail.result;
            this.render();
        });
    }

    applyTheme(theme) {
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.setLightMode(!prefersDark);
        } else {
            this.setLightMode(theme === 'light');
        }
    }

    setLightMode(isLight) {
        if (isLight) {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }
    }

    cycleTheme() {
        // Cycle: Dark -> Light -> System -> Dark
        const modes = ['dark', 'light', 'system'];
        const currentIdx = modes.indexOf(this.currentTheme);
        // Handle case where currentTheme might be invalid or old
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % modes.length;

        this.currentTheme = modes[nextIdx];
        localStorage.setItem('theme', this.currentTheme);
        this.applyTheme(this.currentTheme);
        this.updateThemeBtnIcon();
    }

    updateThemeBtnIcon() {
        if (!this.themeBtn) return;

        let icon = '';
        let title = '';

        switch (this.currentTheme) {
            case 'light':
                icon = '☀️'; // Sun
                title = 'Light Mode';
                break;
            case 'dark':
                icon = '🌙'; // Moon
                title = 'Dark Mode';
                break;
            case 'system':
                icon = '💻'; // Laptop/System
                title = 'System Default';
                break;
        }

        const iconSpan = this.themeBtn.querySelector('.theme-icon');
        if (iconSpan) iconSpan.textContent = icon;
        this.themeBtn.title = title;
    }

    async checkConfigStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();

            if (data.private) {
                this.privateTutor = true;
                if (this.state.view === 'splash') { this.state.view = 'tutor'; this.render(); }
            } else if (data.mode === 'simple') {
                this.showSimpleModeWarning(data.missing);
            }
        } catch (e) {
            console.warn("Failed to check config status:", e);
        }
    }

    showSimpleModeWarning(missing) {
        const warning = document.createElement('div');
        warning.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #fff3cd;
            color: #856404;
            padding: 8px 16px;
            text-align: center;
            font-size: 0.9rem;
            z-index: 9999;
            border-top: 1px solid #ffeeba;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            box-shadow: 0 -2px 10px rgba(0,0,0,0.05);
        `;

        const missingText = missing.join(' & ');
        warning.innerHTML = `
            <span>⚠️ <b>Simple Mode Check:</b> Production security features (${missingText}) are not configured.</span>
            <a href="https://github.com/ZackAkil/immersive-language-learning-with-live-api#advanced-configuration" target="_blank" style="color: #533f03; text-decoration: underline; font-weight: bold; margin-left: 4px;">Learn more</a>
        `;

        this.appendChild(warning);
    }

    render() {
        if (!this.viewContainer) return;

        this.viewContainer.innerHTML = '';
        let currentView;

        switch (this.state.view) {
            case 'splash':
                currentView = document.createElement('view-splash');
                break;
            case 'tutor':
                currentView = document.createElement('view-tutor');
                break;
            case 'missions':
                currentView = document.createElement('view-missions');
                break;
            case 'chat':
                currentView = document.createElement('view-chat');
                currentView.mission = this.state.selectedMission;
                currentView.language = this.state.selectedLanguage;
                currentView.fromLanguage = this.state.selectedFromLanguage;
                currentView.mode = this.state.selectedMode;
                break;
            case 'summary':
                currentView = document.createElement(this.privateTutor ? 'view-tutor-summary' : 'view-summary');
                currentView.result = this.state.sessionResult;
                break;
            default:
                currentView = document.createElement('view-splash');
        }

        currentView.classList.add('fade-in');
        this.viewContainer.appendChild(currentView);
    }
}

customElements.define('app-root', AppRoot);
